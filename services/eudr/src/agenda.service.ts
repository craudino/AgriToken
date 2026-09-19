import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { poolOps, versaoServico, Contexto, log } from '@cpr/nucleo';
import { EudrService } from './eudr.service';

const ctx = (): Contexto => ({ correlacaoId: crypto.randomUUID(), origem: versaoServico('services/eudr') });

/**
 * Reavaliação contínua do selo.
 *
 * O selo EUDR é atributo perecível do colateral: um talhão conforme hoje pode
 * deixar de ser quando a base publica novo alerta. Sem agenda, a reavaliação
 * existia como rota que ninguém chamava — e um selo que nunca é reavaliado é
 * um selo que afirma sobre o passado enquanto o credor decide sobre o futuro.
 */
@Injectable()
export class AgendaEudrService implements OnModuleInit, OnModuleDestroy {
  private temporizador: NodeJS.Timeout | null = null;
  private parando = false;
  private ultima: { em: Date; avaliados: number; mudaram: number } | null = null;

  constructor(private readonly eudr: EudrService) {}

  onModuleInit() {
    if (process.env.AGENDA_DESLIGADA === '1') return;
    const intervalo = Number(process.env.INTERVALO_REAVALIACAO_EUDR_S ?? 900) * 1000;
    const laco = async () => {
      if (this.parando) return;
      try {
        const { rows } = await poolOps().query<{ obtida: boolean }>(
          'SELECT pg_try_advisory_lock($1) AS obtida', [2001]);
        if (rows[0].obtida) {
          try { await this.reavaliarVencidas(); }
          finally { await poolOps().query('SELECT pg_advisory_unlock($1)', [2001]); }
        }
      } catch (e) {
        log.erro(ctx(), 'reavaliação agendada falhou', { erro: (e as Error).message });
      }
      if (!this.parando) this.temporizador = setTimeout(laco, intervalo);
    };
    this.temporizador = setTimeout(laco, 5000);
    log.info(ctx(), 'reavaliação EUDR agendada', { intervalo_s: intervalo / 1000 });
  }

  onModuleDestroy() {
    this.parando = true;
    if (this.temporizador) clearTimeout(this.temporizador);
  }

  /**
   * Reavalia o que está perto de vencer, e não tudo: reavaliar o universo a
   * cada ciclo custa uma consulta por base por talhão, e o custo de verificação
   * é justamente uma das lacunas que o MVP mede.
   */
  private async reavaliarVencidas() {
    const { rows } = await poolOps().query<{ talhao_id: string }>(
      `SELECT DISTINCT t.id AS talhao_id
         FROM ops.talhao t
         LEFT JOIN LATERAL (
           SELECT valida_ate FROM ops.evidencia_eudr e
            WHERE e.talhao_id = t.id ORDER BY gerada_em DESC LIMIT 1) ult ON true
        WHERE ult.valida_ate IS NULL OR ult.valida_ate < now() + interval '30 days'
        LIMIT 25`);

    let mudaram = 0;
    for (const r of rows) {
      try {
        const res = await this.eudr.reavaliar(ctx(), r.talhao_id);
        if (res.mudou_resultado) mudaram++;
      } catch (e) {
        log.aviso(ctx(), 'reavaliação de talhão falhou', { talhao_id: r.talhao_id, erro: (e as Error).message });
      }
    }
    this.ultima = { em: new Date(), avaliados: rows.length, mudaram };
    if (mudaram) log.aviso(ctx(), 'selos mudaram de resultado na reavaliação', { mudaram, de: rows.length });
  }

  estado() {
    return {
      ligada: process.env.AGENDA_DESLIGADA !== '1',
      ultima: this.ultima ? { ...this.ultima, em: this.ultima.em.toISOString() } : null,
    };
  }
}
