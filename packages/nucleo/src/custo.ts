import { Pool, PoolClient } from 'pg';

export type Etapa =
  | 'KYC_DOCUMENTO' | 'KYC_LISTAS' | 'CAR_SICAR' | 'POLIGONO_INGESTAO' | 'POLIGONO_VALIDACAO'
  | 'EUDR_CRUZAMENTO' | 'EUDR_EVIDENCIA' | 'DDS_EMISSAO' | 'REGISTRO_CONSULTA'
  | 'CONCILIACAO_CICLO' | 'PRECO_COLETA' | 'PAGAMENTO_CONFIRMACAO' | 'AVERBACAO_GARANTIA' | 'ANALISE_HUMANA';

export interface Custo {
  etapa: Etapa;
  sujeitoTipo: 'PRODUTOR' | 'TALHAO' | 'CONTRATO' | 'GARANTIA' | 'PLATAFORMA';
  sujeitoId: string;
  automatica: boolean;
  duracaoMs: number;
  tarifaCentavos?: number;
  esforcoHumanoSeg?: number;
  fonte?: string;
  tentativas?: number;
  sucesso: boolean;
}

/**
 * Registra o custo no instante em que ele ocorre (SMC-007). E6 apontou em G1
 * que seis das oito lacunas do MVP são de custo, e que nada media custo: o
 * dossiê de G4 teria de narrar o que deveria demonstrar.
 */
export const registrarCusto = async (db: Pool | PoolClient, c: Custo): Promise<void> => {
  await db.query(
    `INSERT INTO ops.custo_verificacao
       (etapa, sujeito_tipo, sujeito_id, automatica, esforco_humano_seg, duracao_ms,
        tarifa_centavos, fonte, tentativas, sucesso)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [c.etapa, c.sujeitoTipo, c.sujeitoId, c.automatica, c.esforcoHumanoSeg ?? 0,
     Math.round(c.duracaoMs), c.tarifaCentavos ?? 0, c.fonte ?? null, c.tentativas ?? 1, c.sucesso],
  );
};

/** Cronometra uma etapa e registra o custo, inclusive quando ela falha. */
export const comCusto = async <T>(
  db: Pool | PoolClient,
  base: Omit<Custo, 'duracaoMs' | 'sucesso'>,
  fn: () => Promise<T>,
): Promise<T> => {
  const t0 = performance.now();
  try {
    const r = await fn();
    await registrarCusto(db, { ...base, duracaoMs: performance.now() - t0, sucesso: true });
    return r;
  } catch (e) {
    await registrarCusto(db, { ...base, duracaoMs: performance.now() - t0, sucesso: false });
    throw e;
  }
};
