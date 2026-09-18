#!/usr/bin/env node
// Migração forward-only com verificação de integridade.
//
//   node infra/db/migrar.mjs            aplica o que falta
//   node infra/db/migrar.mjs --estado   mostra o que está aplicado
//   node infra/db/migrar.mjs --seco     diz o que faria, sem escrever
//
// Substitui o CPR_RECRIAR=1, que dropava as três bases. Em desenvolvimento
// aquilo era honesto; em ambiente de teste com dados, é perda de dado.
//
// Três garantias, e cada uma existe por um modo de falha conhecido:
//
// 1. **Checksum.** Migração já aplicada que muda de conteúdo interrompe tudo.
//    Editar migração aplicada é como o banco de um ambiente passa a divergir
//    do banco de outro sem ninguém perceber.
// 2. **Ordem estável.** Numeração explícita, aplicada em ordem lexicográfica.
// 3. **Transação por migração.** Uma migração que falha no meio não deixa
//    meia-tabela: ou entra inteira, ou não entra.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import pg from 'pg';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SECO = process.argv.includes('--seco');
const SO_ESTADO = process.argv.includes('--estado');

// Credencial de migração é distinta da credencial de execução, e isso não é
// zelo: migrar com o usuário da aplicação significa que a aplicação pode
// alterar o esquema em tempo de execução — privilégio que ela não deveria ter,
// e que um comprometimento aproveitaria imediatamente.
const BASES = [
  { nome: 'ops',   url: process.env.OPS_URL_MIGRACAO,   execucao: process.env.OPS_URL,
    baseline: 'docs/contracts/db/ops',   migracoes: 'infra/db/migracoes/ops' },
  { nome: 'pii',   url: process.env.PII_URL_MIGRACAO,   execucao: process.env.PII_URL,
    baseline: 'docs/contracts/db/pii',   migracoes: 'infra/db/migracoes/pii' },
  { nome: 'audit', url: process.env.AUDIT_URL_MIGRACAO, execucao: process.env.AUDIT_URL,
    baseline: 'docs/contracts/db/audit', migracoes: 'infra/db/migracoes/audit' },
];

const TABELA = `
CREATE TABLE IF NOT EXISTS public.migracao (
  nome        text PRIMARY KEY,
  checksum    text NOT NULL,
  aplicada_em timestamptz NOT NULL DEFAULT now(),
  duracao_ms  integer NOT NULL,
  origem      text NOT NULL
);
COMMENT ON TABLE public.migracao IS
  'Registro de migrações aplicadas. O checksum existe para detectar edição de '
  'migração já aplicada — a forma silenciosa de dois ambientes divergirem.';`;

const soma = (conteudo) => createHash('sha256').update(conteudo).digest('hex').slice(0, 16);

const arquivosDe = (dir, origem) => {
  const caminho = join(RAIZ, dir);
  if (!existsSync(caminho)) return [];
  return readdirSync(caminho)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({
      nome: `${origem}/${basename(f)}`,
      caminho: join(caminho, f),
      conteudo: readFileSync(join(caminho, f), 'utf8'),
      origem,
    }));
};

let houveFalha = false;

for (const base of BASES) {
  if (!base.url) {
    console.error(`${base.nome}: ${base.nome.toUpperCase()}_URL_MIGRACAO não definida`);
    houveFalha = true; continue;
  }
  if (base.execucao && base.url === base.execucao) {
    console.error(`${base.nome}: a credencial de migração é a mesma da aplicação — recusado`);
    houveFalha = true; continue;
  }
  const cliente = new pg.Client({ connectionString: base.url });
  await cliente.connect();

  try {
    if (!SECO) await cliente.query(TABELA);
    const { rows: aplicadas } = await cliente.query(
      "SELECT nome, checksum, aplicada_em FROM public.migracao ORDER BY nome"
    ).catch(() => ({ rows: [] }));
    const jaAplicadas = new Map(aplicadas.map((r) => [r.nome, r.checksum]));

    const pendentes = [];
    const alteradas = [];
    for (const arq of [...arquivosDe(base.baseline, 'baseline'), ...arquivosDe(base.migracoes, 'migracao')]) {
      const cs = soma(arq.conteudo);
      if (!jaAplicadas.has(arq.nome)) pendentes.push({ ...arq, checksum: cs });
      else if (jaAplicadas.get(arq.nome) !== cs) alteradas.push(arq.nome);
    }

    if (SO_ESTADO) {
      console.log(`\n${base.nome}: ${jaAplicadas.size} aplicada(s), ${pendentes.length} pendente(s)`);
      for (const a of aplicadas.slice(-3)) console.log(`  ✓ ${a.nome}`);
      for (const p of pendentes) console.log(`  · ${p.nome}`);
      continue;
    }

    if (alteradas.length) {
      // Parar aqui é o ponto. Reaplicar por cima esconderia a divergência, que
      // é exatamente o risco que o briefing coloca como mais provável.
      console.error(`\n${base.nome}: MIGRAÇÃO APLICADA FOI ALTERADA — nada será executado`);
      for (const a of alteradas) console.error(`  ! ${a}`);
      console.error('  Migração aplicada é imutável. Crie uma nova migração com a correção.');
      houveFalha = true;
      continue;
    }

    if (!pendentes.length) { console.log(`${base.nome}: em dia (${jaAplicadas.size} migrações)`); continue; }

    console.log(`\n${base.nome}: ${pendentes.length} migração(ões) pendente(s)`);
    for (const m of pendentes) {
      if (SECO) { console.log(`  → aplicaria ${m.nome}`); continue; }
      const t0 = Date.now();
      try {
        await cliente.query('BEGIN');
        await cliente.query(m.conteudo);
        await cliente.query(
          'INSERT INTO public.migracao (nome, checksum, duracao_ms, origem) VALUES ($1,$2,$3,$4)',
          [m.nome, m.checksum, Date.now() - t0, m.origem]);
        await cliente.query('COMMIT');
        console.log(`  ✓ ${m.nome} (${Date.now() - t0} ms)`);
      } catch (e) {
        await cliente.query('ROLLBACK');
        console.error(`  ✗ ${m.nome}: ${e.message.split('\n')[0]}`);
        houveFalha = true;
        break;      // ordem importa: não pula migração que falhou
      }
    }
  } finally {
    await cliente.end();
  }
}

process.exit(houveFalha ? 1 : 0);
