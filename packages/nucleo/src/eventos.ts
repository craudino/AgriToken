import { PoolClient } from 'pg';
import { hashPayload } from './canonico';
import { Contexto } from './telemetria';
import { auditar, SujeitoTipo } from './auditoria';
import { CATALOGO_EVENTOS, EntradaCatalogo } from './catalogo-eventos';

const CATALOGO = new Map<string, EntradaCatalogo>(CATALOGO_EVENTOS.map((e) => [e.tipo, e]));

export interface Evento {
  tipo: string;
  sujeitoTipo: SujeitoTipo;
  sujeitoId: string;
  payload: Record<string, unknown>;
  evidencia?: unknown[];
  atorRef?: string | null;
  atorTipo?: 'HUMANO' | 'SERVICO' | 'AGENDA' | 'EXTERNO';
  causaId?: string | null;
  ocorridoEm?: Date;
}

/**
 * Publica na caixa de saída dentro da mesma transação do fato, e grava na
 * trilha de auditoria. O evento vive na transação porque um fato registrado
 * sem evento é um fato que o resto do sistema nunca soube.
 *
 * Evento marcado `exige_evidencia` sem evidência é recusado aqui: afirmação
 * sem lastro não entra na trilha (P5).
 */
export const publicar = async (c: PoolClient, ctx: Contexto, ev: Evento): Promise<string> => {
  const meta = CATALOGO.get(ev.tipo);
  if (!meta) throw new Error(`evento fora do catálogo congelado: ${ev.tipo}`);
  const evidencia = ev.evidencia ?? [];
  if (meta.exige_evidencia && evidencia.length === 0) {
    throw new Error(`evento ${ev.tipo} exige evidência e não recebeu nenhuma (P5)`);
  }
  if (meta.sujeito !== ev.sujeitoTipo) {
    throw new Error(`evento ${ev.tipo} é de sujeito ${meta.sujeito}, recebeu ${ev.sujeitoTipo}`);
  }

  const ocorridoEm = ev.ocorridoEm ?? new Date();
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO ops.evento (tipo, sujeito_tipo, sujeito_id, correlacao_id, causa_id, ator_ref,
                             origem, ocorrido_em, payload, evidencia, payload_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, decode($11,'hex')) RETURNING id`,
    [ev.tipo, ev.sujeitoTipo, ev.sujeitoId, ctx.correlacaoId, ev.causaId ?? null,
     ev.atorRef ? Buffer.from(ev.atorRef, 'hex') : null, ctx.origem, ocorridoEm,
     JSON.stringify(ev.payload), JSON.stringify(evidencia),
     hashPayload(ev.payload).slice(2)],
  );

  if (meta.auditavel) {
    await auditar(ctx, {
      tipo: ev.tipo, sujeitoTipo: ev.sujeitoTipo, sujeitoId: ev.sujeitoId,
      atorRef: ev.atorRef ?? null, payload: ev.payload, evidencia, ocorridoEm,
    });
  }
  return rows[0].id;
};

export const tiposDoCatalogo = (): string[] => [...CATALOGO.keys()];
