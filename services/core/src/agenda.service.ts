import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { poolOps, poolAudit, versaoServico, Contexto, log, verificarCadeia, POLITICA_DIVERGENCIA } from '@cpr/nucleo';
import { ConciliacaoService } from './conciliacao.service';

const ctx = (): Contexto => ({ correlacaoId: crypto.randomUUID(), origem: versaoServico('services/core') });

interface Tarefa {
  nome: string;
  intervaloMs: number;
  /** Chave da trava consultiva. Duas réplicas, uma execução. */
  trava: number;
  executar: () => Promise<void>;
}

/**
 * Agenda das rotinas que precisam acontecer sozinhas.
 *
 * Até aqui a conciliação só rodava quando alguém chamava a rota. O SLA de
 * quinze minutos de `ops.politica_divergencia` era uma coluna de tabela, não um
 * comportamento — e um SLA que ninguém cumpre é pior que SLA nenhum, porque
 * cria a impressão de vigilância.
 *
 * Duas decisões de implementação que evitam problemas conhecidos:
 *
 * 1. **Trava consultiva no PostgreSQL.** Com duas réplicas do núcleo, dois
 *    laços de conciliação rodariam em paralelo e duplicariam incidente. A trava
 *    é por tarefa, não por processo, e some sozinha se o processo morrer.
 * 2. **Sem sobreposição.** Uma execução que demora mais que o intervalo não
 *    dispara a seguinte: o laço reagenda a partir do fim, não do início.
 */
@Injectable()
export class AgendaService implements OnModuleInit, OnModuleDestroy {
  private temporizadores: NodeJS.Timeout[] = [];
  private ultimas = new Map<string, { em: Date; duracaoMs: number; erro?: string }>();
  private parando = false;

  constructor(private readonly conciliacao: ConciliacaoService) {}

  onModuleInit() {
    if (process.env.AGENDA_DESLIGADA === '1') {
      log.aviso(ctx(), 'agenda desligada por configuração', {});
      return;
    }
    const seg = (v: string | undefined, padrao: number) => Number(v ?? padrao) * 1000;

    this.agendar({
      nome: 'conciliacao',
      intervaloMs: seg(process.env.INTERVALO_CONCILIACAO_S, 60),
      trava: 1001,
      executar: async () => { await this.conciliacao.executar(ctx(), 'COMPLETA'); },
    });

    this.agendar({
      nome: 'sentinela-sla',
      intervaloMs: seg(process.env.INTERVALO_SENTINELA_S, 120),
      trava: 1002,
      executar: () => this.sentinelaSla(),
    });

    this.agendar({
      nome: 'integridade-trilha',
      intervaloMs: seg(process.env.INTERVALO_TRILHA_S, 600),
      trava: 1003,
      executar: () => this.integridadeTrilha(),
    });
  }

  onModuleDestroy() {
    this.parando = true;
    for (const t of this.temporizadores) clearTimeout(t);
  }

  private agendar(t: Tarefa) {
    const laco = async () => {
      if (this.parando) return;
      const t0 = Date.now();
      try {
        const { rows } = await poolOps().query<{ obtida: boolean }>(
          'SELECT pg_try_advisory_lock($1) AS obtida', [t.trava]);
        if (!rows[0].obtida) {
          // Outra réplica está com a tarefa. Não é erro, é o mecanismo funcionando.
          log.debug(ctx(), 'tarefa já em execução em outra réplica', { tarefa: t.nome });
        } else {
          try { await t.executar(); } finally {
            await poolOps().query('SELECT pg_advisory_unlock($1)', [t.trava]);
          }
        }
        this.ultimas.set(t.nome, { em: new Date(), duracaoMs: Date.now() - t0 });
      } catch (e) {
        this.ultimas.set(t.nome, { em: new Date(), duracaoMs: Date.now() - t0, erro: (e as Error).message });
        log.erro(ctx(), 'tarefa agendada falhou', { tarefa: t.nome, erro: (e as Error).message });
      }
      // Reagenda a partir do fim: execução lenta não empilha execução nova.
      if (!this.parando) this.temporizadores.push(setTimeout(laco, t.intervaloMs));
    };
    // Espaça o início para que as três tarefas não disputem a primeira janela.
    this.temporizadores.push(setTimeout(laco, 3000 + this.temporizadores.length * 2000));
    log.info(ctx(), 'tarefa agendada', { tarefa: t.nome, intervalo_s: t.intervaloMs / 1000 });
  }

  /**
   * Divergência aberta além do SLA do seu tipo é o alerta que interessa ao
   * negócio: não "o serviço está no ar", e sim "o compromisso de detectar e
   * tratar está sendo cumprido".
   */
  private async sentinelaSla() {
    const { rows } = await poolOps().query<{ tipo: string; id: string; aberta_ha_s: string }>(
      `SELECT d.tipo, d.id, EXTRACT(epoch FROM (now() - d.detectada_em)) AS aberta_ha_s
         FROM ops.divergencia d
        WHERE d.estado IN ('ABERTA','EM_RECONCILIACAO')`);
    const sla = new Map(POLITICA_DIVERGENCIA.map((p) => [p.tipo, p.slaDeteccao]));
    const emAtraso = rows.filter((r) => {
      const texto = sla.get(r.tipo as never) ?? '1 hour';
      const n = Number(texto.split(' ')[0]);
      const unidade = texto.split(' ')[1] ?? 'hour';
      const limite = n * (unidade.startsWith('minute') ? 60 : unidade.startsWith('hour') ? 3600 : 86400);
      // O SLA da política é de detecção; para divergência aberta usamos o
      // prazo de reconciliação do ADR-0007: trinta dias corridos.
      return Number(r.aberta_ha_s) > Math.max(limite, 30 * 86400);
    });

    const { rows: ultima } = await poolOps().query<{ em: Date | null }>(
      'SELECT max(concluida_em) AS em FROM ops.conciliacao_execucao WHERE NOT falhou');
    const silencio = ultima[0].em ? (Date.now() - new Date(ultima[0].em).getTime()) / 1000 : Infinity;

    if (emAtraso.length) {
      log.erro(ctx(), 'divergências abertas além do prazo de reconciliação', {
        quantidade: emAtraso.length, ids: emAtraso.slice(0, 5).map((d) => d.id),
      });
    }
    if (silencio > 15 * 60) {
      // Conciliação parada é pior que divergência aberta: para quem olha de
      // fora, ausência de divergência e ausência de conciliação são a mesma
      // coisa.
      log.erro(ctx(), 'conciliação sem execução bem-sucedida recente', { silencio_s: Math.round(silencio) });
    }
  }

  /** Cadeia de auditoria inconsistente é o alerta mais importante e o mais esquecido. */
  private async integridadeTrilha() {
    const r = await verificarCadeia();
    if (r.inconsistentes > 0) {
      log.erro(ctx(), 'CADEIA DE AUDITORIA INCONSISTENTE', r);
    } else {
      log.debug(ctx(), 'cadeia de auditoria íntegra', r);
    }
  }

  /** Estado da agenda, para o painel e para a sonda de prontidão. */
  estado() {
    const saida: Record<string, unknown> = {};
    for (const [nome, u] of this.ultimas) {
      saida[nome] = { ultima_em: u.em.toISOString(), duracao_ms: u.duracaoMs, erro: u.erro ?? null };
    }
    return { ligada: process.env.AGENDA_DESLIGADA !== '1', tarefas: saida };
  }
}
