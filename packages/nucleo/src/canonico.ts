import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Forma canônica de um JSON: chaves ordenadas, sem espaços. É a mesma regra
 * implementada em `jsonb_canonical` no banco de auditoria, e as duas são
 * comparadas em CI. Sem isso, o mesmo payload produziria hashes diferentes
 * conforme a ordem de serialização, e P6 cairia sem ninguém perceber.
 */
export const canonico = (v: unknown): string => {
  if (Array.isArray(v)) return '[' + v.map(canonico).join(',') + ']';
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canonico(o[k])).join(',') + '}';
  }
  return JSON.stringify(v ?? null);
};

export const sha256Hex = (s: string | Buffer): string =>
  '0x' + createHash('sha256').update(s).digest('hex');

export const hashPayload = (payload: unknown): string => sha256Hex(canonico(payload));

/** Âncora de registro: determinística por exigência de idempotência (P3). */
export const ancoraRegistro = (entidade: string, registroId: string): string =>
  sha256Hex(`${entidade}|${registroId}`);

/**
 * Pseudônimo de 128 bits, ALEATÓRIO. Nunca derivar de documento: hash de CPF
 * quebra por dicionário em minutos (ADR-0002).
 */
export const novaRefOpaca = (): string => randomBytes(16).toString('hex');

/** Índice cego do cofre de PII: HMAC com chave de serviço, não hash simples. */
export const hmacDocumento = (documento: string, chaveServico: string): Buffer =>
  createHmac('sha256', chaveServico).update(documento.replace(/\D/g, '')).digest();
