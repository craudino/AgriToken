#!/usr/bin/env node
// Verificação estática do ambiente em contêineres.
//
// O compose não pôde ser executado onde foi escrito (sem daemon Docker). Isso
// não é desculpa para entregá-lo sem verificação nenhuma: o que dá para
// conferir sem subir nada, se confere aqui — arquivos referenciados existem,
// segredos não têm valor padrão, e a topologia de rede corresponde ao que a
// arquitetura promete.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let YAML;
try { YAML = require('yaml'); } catch { console.error('pacote yaml ausente'); process.exit(2); }

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ARQUIVO = join(RAIZ, 'infra/compose/docker-compose.yml');
const doc = YAML.parse(readFileSync(ARQUIVO, 'utf8'));

const falhas = [];
const ok = (m) => console.log(`OK  ${m}`);
const servicos = doc.services ?? {};

// 1. Todo Dockerfile referenciado existe.
for (const [nome, s] of Object.entries(servicos)) {
  if (!s.build) continue;
  const df = join(RAIZ, s.build.dockerfile);
  if (!existsSync(df)) falhas.push(`${nome}: Dockerfile ausente — ${s.build.dockerfile}`);
  const caminho = s.build.args?.CAMINHO;
  if (caminho && !existsSync(join(RAIZ, caminho))) falhas.push(`${nome}: CAMINHO inexistente — ${caminho}`);
}
if (!falhas.length) ok('todo Dockerfile e caminho de build referenciado existe');

// 2. Segredo com valor padrão é segredo publicado. Toda variável de senha ou
//    chave precisa usar a forma ${VAR:?}, que faz o compose falhar sem ela.
const antes2 = falhas.length;
const texto = readFileSync(ARQUIVO, 'utf8');
const SENSIVEIS = /\$\{(SENHA_[A-Z_]+|CPR_SEGREDO_JWT|CHAVE_INDICE_CEGO|CORS_ORIGENS|BOOTNODE)([^}]*)\}/g;
const semObrigatoriedade = new Set();
for (const m of texto.matchAll(SENSIVEIS)) {
  const variavel = m[1];
  // Basta a variável ser obrigatória na primeira ocorrência; nas demais o
  // compose já teria falhado.
  if (m[2].startsWith(':?')) semObrigatoriedade.delete(variavel);
  else if (!semObrigatoriedade.has(variavel) && !texto.includes(`\${${variavel}:?`)) {
    semObrigatoriedade.add(variavel);
  }
}
for (const v of semObrigatoriedade) falhas.push(`segredo ${v} sem :? — subiria com valor vazio`);
if (falhas.length === antes2) ok('nenhum segredo tem valor padrão: faltando, o compose não sobe');

// 3. Topologia: só o compliance alcança a rede do cofre. É a promessa do
//    ADR-0002 em forma verificável.
const antes3 = falhas.length;
const noCofre = Object.entries(servicos)
  .filter(([, s]) => (s.networks ?? []).includes?.('cofre'))
  .map(([n]) => n);
const esperadoNoCofre = ['bd-pii', 'compliance', 'migracao'];
for (const n of noCofre) {
  if (!esperadoNoCofre.includes(n)) falhas.push(`${n} está na rede do cofre e não deveria (ADR-0002)`);
}
for (const n of ['bd-pii', 'compliance']) {
  if (!noCofre.includes(n)) falhas.push(`${n} deveria estar na rede do cofre`);
}
if (falhas.length === antes3) ok(`rede do cofre tem só ${noCofre.join(', ')}`);

// 4. Nenhum serviço que não seja o compliance declara PII_URL: não declarar é
//    mais forte que declarar e não usar.
const antes4 = falhas.length;
for (const [nome, s] of Object.entries(servicos)) {
  const env = s.environment ?? {};
  if (nome !== 'compliance' && nome !== 'migracao' && env.PII_URL) {
    falhas.push(`${nome} declara PII_URL sem precisar do cofre`);
  }
}
if (falhas.length === antes4) ok('só o compliance recebe credencial do cofre de PII');

// 5. Portas expostas ao hospedeiro: só a interface. Serviço com porta exposta
//    é serviço alcançável de fora da rede do compose.
const antes5 = falhas.length;
for (const [nome, s] of Object.entries(servicos)) {
  if (s.ports?.length && nome !== 'web') falhas.push(`${nome} expõe porta ao hospedeiro: ${s.ports}`);
}
if (falhas.length === antes5) ok('só a interface expõe porta ao hospedeiro');

// 6. O simulador de registradora fica atrás de perfil, para não subir por
//    engano em ambiente com dado real.
const antes6 = falhas.length;
if (!servicos.registradora?.profiles?.includes('teste')) {
  falhas.push('simulador de registradora sem profile: subiria junto com o resto');
}
if (falhas.length === antes6) ok('simulador de registradora só sobe no perfil de teste');

// 7. AMBIENTE padrão não pode ser desenvolvimento: seria escopo de simulador
//    válido e rotas /sim abertas.
const antes7 = falhas.length;
if (/AMBIENTE:\s*\$\{AMBIENTE:-desenvolvimento\}/.test(texto)) {
  falhas.push('AMBIENTE tem desenvolvimento como padrão no compose');
}
if (falhas.length === antes7) ok('AMBIENTE não tem desenvolvimento como padrão');

console.log(`\ncompose: ${Object.keys(servicos).length} serviços, ${Object.keys(doc.networks ?? {}).length} redes`);
if (falhas.length) {
  console.error('\nAmbiente em contêineres NÃO conforme:');
  for (const f of falhas) console.error('  - ' + f);
  process.exit(1);
}
console.log('verificação estática do compose conforme (execução real ainda pendente)');
