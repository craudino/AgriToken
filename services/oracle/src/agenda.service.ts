import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { poolOps, versaoServico, Contexto, log } from '@cpr/nucleo';
import { QuorumService } from './quorum.service';

const ctx = (): Contexto => ({ correlacaoId: crypto.randomUUID(), origem: versaoServico('services/oracle') });

/**
 * Coleta periódica de preço.
 *
 * A janela de validade de PRECO é de 36 horas (ADR-0003). Sem coleta agendada,
 * a leitura vigente envelhece até expirar e a marcação a mercado simplesmente
 * para — o que é seguro, e inútil. Coletar de hora em hora mantém a leitura
 * fresca e, mais importante, faz a queda de preço aparecer no painel enquanto
 * ela acontece, que é a pró-ciclicidade que o MVP existe para medir.
 */
@Injectable()
export class AgendaOraculoService implements OnModuleInit, OnModuleDestroy {
  private temporizador: NodeJS.Timeout | null = null;
  private parando = false;
  private ultima: { em: Date; estado: string; fontes: number } | null = null;

  constructor(private readonly quorum: QuorumService) {}

  onModuleInit() {
    if (process.env.AGENDA_DESLIGADA === '1') return;
    const intervalo = Number(process.env.INTERVALO_COLETA_PRECO_S ?? 3600) * 1000;
    const chaves = (process.env.CHAVES_PRECO ?? 'CAFE_ARABICA/BRL-SACA').split(',');

    const laco = async () => {
      if (this.parando) return;
      try {
        const { rows } = await poolOps().query<{ obtida: boolean }>(
          'SELECT pg_try_advisory_lock($1) AS obtida', [3001]);
        if (rows[0].obtida) {
          try {
            for (const chave of chaves) {
              const r = await this.quorum.coletar(ctx(), 'PRECO', chave.trim());
              this.ultima = { em: new Date(), estado: r.estado, fontes: r.fontesIndependentes };
              if (r.estado === 'SEM_QUORUM') {
                // Não é falha do laço: é a informação que o credor precisa ver.
                log.aviso(ctx(), 'coleta de preço sem quórum', { chave, falhas: r.falhas });
              }
            }
          } finally { await poolOps().query('SELECT pg_advisory_unlock($1)', [3001]); }
        }
      } catch (e) {
        log.erro(ctx(), 'coleta agendada de preço falhou', { erro: (e as Error).message });
      }
      if (!this.parando) this.temporizador = setTimeout(laco, intervalo);
    };
    this.temporizador = setTimeout(laco, 4000);
    log.info(ctx(), 'coleta de preço agendada', { intervalo_s: intervalo / 1000, chaves });
  }

  onModuleDestroy() {
    this.parando = true;
    if (this.temporizador) clearTimeout(this.temporizador);
  }

  estado() {
    return {
      ligada: process.env.AGENDA_DESLIGADA !== '1',
      ultima: this.ultima ? { ...this.ultima, em: this.ultima.em.toISOString() } : null,
    };
  }
}
