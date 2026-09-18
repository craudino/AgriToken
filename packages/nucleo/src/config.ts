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

export const configBases = (): ConfigBases => {
  const cfg = { ops: exigir('OPS_URL'), pii: exigir('PII_URL'), audit: exigir('AUDIT_URL') };
  // A separação é premissa de segurança, não detalhe de configuração: um
  // ambiente que aponte as três para o mesmo banco não sobe.
  const bancos = Object.values(cfg).map((u) => new URL(u).pathname);
  if (new Set(bancos).size !== 3) {
    throw new Error('OPS_URL, PII_URL e AUDIT_URL precisam apontar para bancos distintos (ADR-0002)');
  }
  return cfg;
};

export const versaoServico = (nome: string): string => `${nome}@${process.env.VERSAO ?? '0.1.0'}`;
