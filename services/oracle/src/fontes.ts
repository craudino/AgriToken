import { chamar } from '@cpr/nucleo';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Adaptadores de fonte externa. No MVP as fontes são simuladas sobre a massa
 * sintética, mas o contrato de cada adaptador é o da integração real: devolve
 * valor, payload cru e latência, ou falha.
 *
 * `derrubar` existe para o teste de falha injetada exigido pelo aceite de W3 —
 * degradação graciosa que nunca foi exercitada sob falha não é degradação
 * graciosa, é esperança.
 */
export interface Leitura {
  fonte: string;
  valorNumerico?: string;
  valorJson?: unknown;
  bruto: unknown;
  latenciaMs: number;
}

const CAMINHO_MASSA = join(__dirname, '../../../infra/dados/massa.json');
let massa: { serie_preco: Array<Record<string, number | string>> } | null = null;
const carregarMassa = () => {
  if (!massa && existsSync(CAMINHO_MASSA)) massa = JSON.parse(readFileSync(CAMINHO_MASSA, 'utf8'));
  return massa;
};

const derrubadas = new Set<string>();
export const derrubar = (fonte: string) => derrubadas.add(fonte);
export const levantar = (fonte: string) => derrubadas.delete(fonte);
export const fontesDerrubadas = () => [...derrubadas];

/** Índice do dia corrente na série, avançado pelo cenário de estresse. */
let diaCorrente = Number(process.env.DIA_SERIE ?? 0);
export const avancarDia = (n = 1) => { diaCorrente += n; return diaCorrente; };
export const definirDia = (n: number) => { diaCorrente = n; return diaCorrente; };
export const diaAtual = () => diaCorrente;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const lerPreco = async (fonte: string): Promise<Leitura> => {
  if (derrubadas.has(fonte)) throw new Error(`fonte ${fonte} indisponível`);
  const m = carregarMassa();
  if (!m) throw new Error('massa sintética ausente: rode node infra/dados/massa.mjs');
  const linha = m.serie_preco[Math.min(diaCorrente, m.serie_preco.length - 1)];
  const valor = linha[fonte];
  if (valor === undefined) throw new Error(`fonte ${fonte} não publica preço`);
  const t0 = performance.now();
  await dormir(2);
  return {
    fonte,
    valorNumerico: Number(valor).toFixed(2),
    bruto: { fonte, data: linha.data, valor, unidade: 'BRL/saca', consultado_em: new Date().toISOString() },
    latenciaMs: performance.now() - t0,
  };
};

/** Pagamento: fato binário. Duas fontes que discordam significam "não se sabe". */
const pagamentosConfirmados = new Map<string, { valor: string; em: string }>();
export const confirmarPagamento = (chave: string, valor: string) =>
  pagamentosConfirmados.set(chave, { valor, em: new Date().toISOString() });

export const lerPagamento = async (fonte: string, chave: string): Promise<Leitura> => {
  if (derrubadas.has(fonte)) throw new Error(`fonte ${fonte} indisponível`);
  const p = pagamentosConfirmados.get(chave);
  return {
    fonte,
    valorJson: { confirmado: Boolean(p), valor: p?.valor ?? null, em: p?.em ?? null },
    bruto: { fonte, chave, resultado: p ?? null, consultado_em: new Date().toISOString() },
    latenciaMs: 1,
  };
};

/** Geoespacial: resultado do cruzamento é calculado por A4 e publicado aqui. */
const geoPorChave = new Map<string, Map<string, unknown>>();
export const publicarGeo = (chave: string, fonte: string, resultado: unknown) => {
  if (!geoPorChave.has(chave)) geoPorChave.set(chave, new Map());
  geoPorChave.get(chave)!.set(fonte, resultado);
};

export const lerGeo = async (fonte: string, chave: string): Promise<Leitura> => {
  if (derrubadas.has(fonte)) throw new Error(`fonte ${fonte} indisponível`);
  const r = geoPorChave.get(chave)?.get(fonte);
  if (r === undefined) throw new Error(`fonte ${fonte} sem resultado para ${chave}`);
  return {
    fonte, valorJson: r,
    bruto: { fonte, chave, resultado: r, consultado_em: new Date().toISOString() },
    latenciaMs: 3,
  };
};

/** Registro: o estado do título segundo a registradora, consultado duas vezes. */
export const lerRegistro = async (fonte: string, chave: string, url: string): Promise<Leitura> => {
  if (derrubadas.has(fonte)) throw new Error(`fonte ${fonte} indisponível`);
  const t0 = performance.now();
  const resposta = await chamar(`${url}/titulos/${chave}`, { servico: 'services/oracle' });
  if (!resposta.ok) throw new Error(`registradora respondeu ${resposta.status}`);
  const corpo = await resposta.json();
  return {
    fonte, valorJson: corpo, bruto: corpo, latenciaMs: performance.now() - t0,
  };
};
