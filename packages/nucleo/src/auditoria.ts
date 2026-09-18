import { poolAudit } from './bd';
import { Contexto } from './telemetria';

export type SujeitoTipo = 'CONTRATO' | 'PRODUTOR' | 'TALHAO' | 'LEITURA' | 'GARANTIA' | 'DDS' | 'TITULAR' | 'PLATAFORMA';

export interface RegistroAuditoria {
  tipo: string;
  sujeitoTipo: SujeitoTipo;
  sujeitoId: string;
  atorRef?: string | null;
  payload: Record<string, unknown>;
  evidencia?: unknown[];
  ocorridoEm?: Date;
}

/**
 * Grava na trilha append-only. O encadeamento de hash é feito pelo banco
 * (`audit.fn_encadeia`), e não aqui, de propósito: um escritor que calculasse
 * o próprio hash poderia forjá-lo. O serviço só entrega o fato.
 */
export const auditar = async (ctx: Contexto, r: RegistroAuditoria): Promise<void> => {
  await poolAudit().query(
    `INSERT INTO audit.registro (id, tipo, sujeito_tipo, sujeito_id, ator_ref, origem, ocorrido_em, payload, evidencia)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)`,
    [r.tipo, r.sujeitoTipo, r.sujeitoId, r.atorRef ?? null, ctx.origem,
     r.ocorridoEm ?? new Date(), JSON.stringify(r.payload), JSON.stringify(r.evidencia ?? [])],
  );
};

/** Verificação da cadeia. Vai ao painel de auditoria e ao alerta de E8. */
export const verificarCadeia = async (): Promise<{ registros: number; inconsistentes: number }> => {
  const { rows } = await poolAudit().query<{ seq: string; ok: boolean }>('SELECT * FROM audit.verifica_cadeia()');
  return { registros: rows.length, inconsistentes: rows.filter((r: { ok: boolean }) => !r.ok).length };
};
