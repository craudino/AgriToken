/**
 * Log estruturado com correlação. A correlação não é conforto de depuração:
 * é a chave que liga o evento, o registro de auditoria e a resposta de API,
 * e sem ela a pergunta "o que se sabia, quando e com base em quê" não fecha.
 */
export interface Contexto {
  correlacaoId: string;
  origem: string;
}

type Nivel = 'debug' | 'info' | 'aviso' | 'erro';

const PADROES_PII: Array<[string, RegExp]> = [
  ['CPF', /(^|[^0-9])\d{3}\.?\d{3}\.?\d{3}-?\d{2}([^0-9]|$)/],
  ['CNPJ', /(^|[^0-9])\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}([^0-9]|$)/],
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
];

/**
 * O log é o vazamento de PII mais comum e o menos vigiado: ninguém revisa
 * linha de log em code review. Aqui o dado identificável é substituído antes
 * de sair, e a substituição é registrada para que o defeito apareça.
 */
export const higienizar = (valor: unknown): unknown => {
  if (typeof valor === 'string') {
    let s = valor;
    for (const [rotulo, re] of PADROES_PII) {
      if (re.test(s)) s = s.replace(new RegExp(re.source, 'g'), `[${rotulo}_SUPRIMIDO]`);
    }
    return s;
  }
  if (Array.isArray(valor)) return valor.map(higienizar);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor as object).map(([k, v]) => [k, higienizar(v)]));
  }
  return valor;
};

export const registrar = (nivel: Nivel, ctx: Contexto, mensagem: string, dados: Record<string, unknown> = {}): void => {
  const linha = {
    nivel,
    ts: new Date().toISOString(),
    origem: ctx.origem,
    correlacao_id: ctx.correlacaoId,
    mensagem,
    ...(higienizar(dados) as Record<string, unknown>),
  };
  const saida = nivel === 'erro' ? process.stderr : process.stdout;
  saida.write(JSON.stringify(linha) + '\n');
};

export const log = {
  debug: (c: Contexto, m: string, d?: Record<string, unknown>) => registrar('debug', c, m, d),
  info: (c: Contexto, m: string, d?: Record<string, unknown>) => registrar('info', c, m, d),
  aviso: (c: Contexto, m: string, d?: Record<string, unknown>) => registrar('aviso', c, m, d),
  erro: (c: Contexto, m: string, d?: Record<string, unknown>) => registrar('erro', c, m, d),
};
