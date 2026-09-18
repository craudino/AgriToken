// Cliente HTTP dos roteiros. Existe por um motivo específico: depois que a
// autenticação passou a valer, um roteiro que não manda token não falha com
// "erro de negócio" — falha com 401, e a mensagem some no meio do JSON. Aqui a
// falha de credencial é explícita.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { emitirToken } = require('../../packages/nucleo/dist/auth.js');

const TOKEN = process.env.CPR_TOKEN ?? emitirToken({
  perfil: 'demonstracao', sub: 'roteiro@demonstracao', ttlSegundos: 7200,
  operador: 'OP-DEMONSTRACAO-01',
});

const cabecalhos = () => ({
  'content-type': 'application/json',
  authorization: `Bearer ${TOKEN}`,
  'x-correlacao-id': crypto.randomUUID(),
});

const tratar = async (r, url) => {
  if (r.status === 401 || r.status === 403) {
    const corpo = await r.text();
    throw new Error(`credencial recusada em ${url}: ${r.status} ${corpo.slice(0, 120)}`);
  }
  return r.json();
};

export const post = async (url, corpo) =>
  tratar(await fetch(url, { method: 'POST', headers: cabecalhos(), body: JSON.stringify(corpo ?? {}) }), url);

export const get = async (url) =>
  tratar(await fetch(url, { headers: cabecalhos() }), url);

export const token = TOKEN;

/**
 * Registra o título na registradora, no papel de **emitente**. O núcleo não faz
 * isto: ele lê e confere. Nos roteiros, quem emite somos nós.
 */
export const registrarComoEmitente = async (urlRegistradora, contrato, garantias = []) => {
  const titulo = {
    entidade: 'REG-SIM',
    registro_id: contrato.registro_id,
    estado: 'VIGENTE',
    titular_ref: contrato.produtor_ref,
    emitente_ref: contrato.produtor_ref,
    commodity: contrato.commodity ?? 'CAFE_ARABICA',
    quantidade: String(contrato.quantidade_sacas ?? '500'),
    valor_face: { valor: String(contrato.valor_face ?? '750000.00'), moeda: 'BRL' },
    vencimento: contrato.vencimento ?? '2027-07-31',
    garantias, onus: [], cessoes: [],
  };
  return post(`${urlRegistradora}/sim/titulos`, titulo);
};
