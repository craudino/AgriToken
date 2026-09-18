import { Pool, PoolClient } from 'pg';
import { urlBase } from './config';

// Um pool por base. O serviço que não precisa do cofre de PII não recebe o
// pool do cofre — a separação começa aqui, não no controle de acesso.
let pools: { ops?: Pool; pii?: Pool; audit?: Pool } = {};

export const poolOps = (): Pool => (pools.ops ??= new Pool({ connectionString: urlBase('ops'), max: 8 }));
export const poolPii = (): Pool => (pools.pii ??= new Pool({ connectionString: urlBase('pii'), max: 4 }));
export const poolAudit = (): Pool => (pools.audit ??= new Pool({ connectionString: urlBase('audit'), max: 4 }));

export const fecharPools = async (): Promise<void> => {
  await Promise.all(Object.values(pools).map((p) => p?.end()));
  pools = {};
};

/** Executa em transação e devolve o resultado, revertendo em qualquer erro. */
export const emTransacao = async <T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
};

export const hex = (b: Buffer | null | undefined): string | null => (b ? '0x' + b.toString('hex') : null);
export const deHex = (s: string): Buffer => Buffer.from(s.replace(/^0x/, ''), 'hex');
