import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

/**
 * Autenticação e autorização por escopo.
 *
 * O JWT é HS256 implementado aqui, sem dependência externa: são trinta linhas
 * de código verificável contra uma cadeia de dependências que ninguém audita.
 * A troca vale enquanto o segredo for simétrico e compartilhado entre serviços
 * do mesmo perímetro; um emissor externo com JWKS é o passo seguinte, e a
 * verificação abaixo é o ponto único onde ele entra.
 *
 * Princípio que rege o desenho: **nenhuma rota é pública por omissão**. Quem
 * escrever rota nova sem declarar escopo recebe recusa, não liberação — o
 * inverso é como toda API acaba aberta sem ninguém decidir isso.
 */

export type Escopo =
  | 'contrato:ler' | 'contrato:escrever'
  | 'conciliacao:executar' | 'conciliacao:reconciliar'
  | 'produtor:onboarding' | 'produtor:ler'
  | 'pii:eliminar' | 'pii:tratamentos'
  | 'credencial:emitir' | 'credencial:verificar'
  | 'participante:habilitar'
  | 'geo:ingerir' | 'geo:avaliar' | 'geo:bruto'
  | 'dds:emitir'
  | 'oraculo:ler' | 'oraculo:coletar' | 'oraculo:disputar' | 'oraculo:publicar-fonte'
  | 'registro:ler'
  | 'auditoria:ler'
  | 'simulador:operar';

/** Perfis. O token carrega escopos; o perfil é só a forma de emiti-los. */
export const PERFIS: Record<string, Escopo[]> = {
  // Produtor vê o que é dele e origina. Não concilia, não reconcilia.
  produtor: ['produtor:ler', 'contrato:ler', 'contrato:escrever', 'geo:ingerir'],

  // Credor avalia antes de ofertar: lê contrato, evidência e linhagem.
  credor: ['contrato:ler', 'auditoria:ler', 'oraculo:ler'],

  // Operador de conciliação reconcilia divergência — e só isso. Separar este
  // papel de quem espelha é o que impede que o mesmo processo que detecta a
  // divergência também a dispense (P1).
  'operador-conciliacao': ['contrato:ler', 'conciliacao:executar', 'conciliacao:reconciliar', 'auditoria:ler'],

  // Operador de privacidade executa pedido de titular. Não vê contrato.
  'operador-privacidade': ['pii:eliminar', 'pii:tratamentos', 'produtor:ler'],

  // Auditor e regulador leem tudo o que é leitura, e não escrevem nada.
  auditor: ['contrato:ler', 'auditoria:ler', 'oraculo:ler', 'pii:tratamentos', 'produtor:ler'],

  // Serviço interno: o que um serviço precisa para falar com outro.
  servico: [
    'contrato:ler', 'contrato:escrever', 'conciliacao:executar',
    'produtor:ler', 'produtor:onboarding', 'participante:habilitar',
    'credencial:emitir', 'credencial:verificar',
    'geo:ingerir', 'geo:avaliar', 'geo:bruto', 'dds:emitir',
    'oraculo:ler', 'oraculo:coletar', 'oraculo:publicar-fonte', 'registro:ler', 'auditoria:ler',
  ],

  // Perfil de demonstração: tudo, inclusive operar o simulador. Só é aceito
  // quando AMBIENTE=desenvolvimento — ver verificarToken.
  demonstracao: [
    'contrato:ler', 'contrato:escrever', 'conciliacao:executar', 'conciliacao:reconciliar',
    'produtor:onboarding', 'produtor:ler', 'pii:eliminar', 'pii:tratamentos',
    'credencial:emitir', 'credencial:verificar', 'participante:habilitar',
    'geo:ingerir', 'geo:avaliar', 'geo:bruto', 'dds:emitir',
    'oraculo:ler', 'oraculo:coletar', 'oraculo:disputar', 'oraculo:publicar-fonte', 'registro:ler',
    'auditoria:ler', 'simulador:operar',
  ],
};

export interface Principal {
  sub: string;
  perfil: string;
  escopos: Escopo[];
  /** Pseudônimo do titular, quando o principal é uma pessoa do domínio. */
  ator_ref?: string;
  /** Identificador funcional do operador humano (ex.: OP-CONCILIACAO-07). */
  operador?: string;
  exp: number;
  jti: string;
}

const SEGREDO_DESENVOLVIMENTO = 'dev-somente-para-desenvolvimento';

export const ambiente = (): string => process.env.AMBIENTE ?? 'desenvolvimento';
export const ehDesenvolvimento = (): boolean => ambiente() === 'desenvolvimento';

const segredo = (): string => {
  const s = process.env.CPR_SEGREDO_JWT ?? SEGREDO_DESENVOLVIMENTO;
  // Um segredo de desenvolvimento em ambiente que não é de desenvolvimento é a
  // forma mais comum de uma API "autenticada" ser aberta na prática.
  if (!ehDesenvolvimento() && s === SEGREDO_DESENVOLVIMENTO) {
    throw new Error('CPR_SEGREDO_JWT não definido fora de desenvolvimento');
  }
  if (!ehDesenvolvimento() && s.length < 32) {
    throw new Error('CPR_SEGREDO_JWT precisa de ao menos 32 caracteres');
  }
  return s;
};

const b64url = (b: Buffer | string): string =>
  Buffer.from(b).toString('base64url');

const assinar = (cabecalhoPayload: string): string =>
  createHmac('sha256', segredo()).update(cabecalhoPayload).digest('base64url');

export interface OpcoesToken {
  perfil: keyof typeof PERFIS | string;
  sub: string;
  escopos?: Escopo[];
  ator_ref?: string;
  operador?: string;
  ttlSegundos?: number;
}

export const emitirToken = (o: OpcoesToken): string => {
  const escopos = o.escopos ?? PERFIS[o.perfil] ?? [];
  if (!escopos.length) throw new Error(`perfil desconhecido e sem escopos: ${o.perfil}`);
  const payload: Principal = {
    sub: o.sub, perfil: String(o.perfil), escopos,
    ator_ref: o.ator_ref, operador: o.operador,
    exp: Math.floor(Date.now() / 1000) + (o.ttlSegundos ?? 3600),
    jti: randomUUID(),
  };
  const cabecalho = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corpo = b64url(JSON.stringify(payload));
  return `${cabecalho}.${corpo}.${assinar(`${cabecalho}.${corpo}`)}`;
};

export class ErroAutenticacao extends Error {
  constructor(readonly status: number, readonly motivo: string) { super(motivo); }
}

export const verificarToken = (token: string): Principal => {
  const partes = token.split('.');
  if (partes.length !== 3) throw new ErroAutenticacao(401, 'token malformado');
  const [cabecalho, corpo, assinatura] = partes;

  const cab = JSON.parse(Buffer.from(cabecalho, 'base64url').toString());
  // 'alg: none' e a confusão de algoritmo são as duas falhas clássicas de JWT;
  // aceitar o algoritmo que o token declara é confiar no atacante.
  if (cab.alg !== 'HS256') throw new ErroAutenticacao(401, 'algoritmo não aceito');

  const esperada = Buffer.from(assinar(`${cabecalho}.${corpo}`));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) {
    throw new ErroAutenticacao(401, 'assinatura inválida');
  }

  const p = JSON.parse(Buffer.from(corpo, 'base64url').toString()) as Principal;
  if (p.exp * 1000 < Date.now()) throw new ErroAutenticacao(401, 'token expirado');

  // Perfil de demonstração carrega escopo de simulador. Fora de
  // desenvolvimento ele não vale, mesmo com assinatura válida: a superfície de
  // injeção de divergência não pode existir onde há dado real.
  if (p.perfil === 'demonstracao' && !ehDesenvolvimento()) {
    throw new ErroAutenticacao(403, 'perfil de demonstração não vale fora de desenvolvimento');
  }
  if (p.escopos?.includes('simulador:operar') && !ehDesenvolvimento()) {
    throw new ErroAutenticacao(403, 'escopo de simulador não vale fora de desenvolvimento');
  }
  return p;
};

export const temEscopo = (p: Principal, exigidos: Escopo[]): boolean =>
  exigidos.every((e) => p.escopos?.includes(e));

/** Origens aceitas pelo CORS. Sem curinga fora de desenvolvimento. */
export const origensPermitidas = (): string[] | boolean => {
  const lista = (process.env.CORS_ORIGENS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (lista.length) return lista;
  if (ehDesenvolvimento()) return ['http://127.0.0.1:3000', 'http://localhost:3000'];
  // Sem lista declarada fora de desenvolvimento, o navegador não fala com a API.
  return false;
};
