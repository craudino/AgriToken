// Configuração comum. As três bases têm credenciais distintas por decisão
// (ADR-0002); o desvio de ambiente do protótipo está no ADR-0008.
export interface ConfigBases {
  ops: string;
  pii: string;
  audit: string;
}

const exigir = (nome: string): string => {
  const v = process.env[nome];
  if (!v) throw new Error(`variável de ambiente ausente: ${nome}`);
  return v;
};

/**
 * Cada base é exigida por quem a usa, e não em bloco.
 *
 * A versão anterior obrigava todo serviço a declarar PII_URL, inclusive os que
 * não têm nada que fazer no cofre — e a saída fácil era apontar a variável para
 * outro banco só para o processo subir. Isso é pior que não ter validação:
 * transforma "não alcança o cofre" em "alcança o cofre com o endereço errado".
 *
 * Agora quem não precisa não declara, e quem tentar abrir o cofre sem ter a
 * credencial falha alto, na primeira chamada, com o nome da variável ausente.
 */
export const urlBase = (qual: 'ops' | 'pii' | 'audit'): string => {
  const variavel = { ops: 'OPS_URL', pii: 'PII_URL', audit: 'AUDIT_URL' }[qual];
  const url = exigir(variavel);

  // A separação continua sendo premissa de segurança: duas bases declaradas
  // apontando para o mesmo banco não passam.
  const outras = (['ops', 'pii', 'audit'] as const)
    .filter((o) => o !== qual)
    .map((o) => process.env[{ ops: 'OPS_URL', pii: 'PII_URL', audit: 'AUDIT_URL' }[o]])
    .filter(Boolean) as string[];
  const caminho = new URL(url).pathname;
  const hospedeiro = new URL(url).host;
  for (const o of outras) {
    if (new URL(o).pathname === caminho && new URL(o).host === hospedeiro) {
      throw new Error(`${variavel} aponta para a mesma base que outra credencial (ADR-0002)`);
    }
  }
  return url;
};

/** Mantido para quem precisa das três de uma vez (migração, ferramentas). */
export const configBases = (): ConfigBases =>
  ({ ops: urlBase('ops'), pii: urlBase('pii'), audit: urlBase('audit') });

export const versaoServico = (nome: string): string => `${nome}@${process.env.VERSAO ?? '0.1.0'}`;
