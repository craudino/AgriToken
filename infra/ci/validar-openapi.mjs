#!/usr/bin/env node
// Verifica os invariantes de API que o lint não enxerga. Cada bloco é um
// princípio do Briefing (Seção 2) em forma executável: se um agente da Fase 1
// romper a fronteira, o build cai aqui, não na revisão do portão.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(RAIZ, 'docs/contracts/openapi');
const METODOS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];

const docs = Object.fromEntries(
  readdirSync(DIR).filter((f) => f.endsWith('.yaml'))
    .map((f) => [f, YAML.parse(readFileSync(join(DIR, f), 'utf8'))]),
);

const falhas = [];
const reprova = (principio, arquivo, msg) => falhas.push(`[${principio}] ${arquivo}: ${msg}`);
const ok = (msg) => console.log(`OK  ${msg}`);

const operacoes = (doc, arquivo) => {
  const saida = [];
  for (const [rota, item] of Object.entries(doc.paths ?? {})) {
    for (const metodo of METODOS) {
      if (item[metodo]) saida.push({ arquivo, rota, metodo, op: item[metodo], paramsRota: item.parameters ?? [] });
    }
  }
  return saida;
};

const todas = Object.entries(docs).flatMap(([arquivo, doc]) => operacoes(doc, arquivo));

// -- P3: efeito irreversível exige chave de idempotência ---------------------
const IRREVERSIVEIS = new Set([
  'criarRascunho', 'transicionar', 'emitirEspelho', 'reconciliar', 'liquidar',
  'ingerirTalhao', 'avaliarTalhao', 'emitirDds', 'abrirDisputa',
  'iniciarOnboarding', 'emitirCredencial', 'eliminarTitular',
]);
for (const { arquivo, rota, metodo, op, paramsRota } of todas) {
  if (!IRREVERSIVEIS.has(op.operationId)) continue;
  const params = [...paramsRota, ...(op.parameters ?? [])];
  const temChave = params.some((p) => JSON.stringify(p).includes('ChaveIdempotencia'));
  if (!temChave) reprova('P3', arquivo, `${metodo.toUpperCase()} ${rota} (${op.operationId}) sem Idempotency-Key`);
}
if (!falhas.length) ok('P3: toda operação irreversível exige Idempotency-Key');

// -- P1: resposta com estado de contrato sinaliza a conciliação --------------
const antes = falhas.length;
for (const { arquivo, rota, metodo, op } of todas) {
  for (const [codigo, resp] of Object.entries(op.responses ?? {})) {
    if (!codigo.startsWith('2')) continue;
    const corpo = JSON.stringify(resp.content ?? {});
    const carregaContrato = /schemas\/Contrato(?!Resumo)/.test(corpo);
    if (!carregaContrato) continue;
    const temCabecalho = JSON.stringify(resp.headers ?? {}).includes('X-Conciliacao-Situacao');
    if (!temCabecalho) {
      reprova('P1', arquivo, `${metodo.toUpperCase()} ${rota} ${codigo} devolve contrato sem X-Conciliacao-Situacao`);
    }
  }
}
if (falhas.length === antes) ok('P1: toda resposta com estado de contrato sinaliza a conciliação');

// -- P1/P7: não existe rota que escreva no registro --------------------------
const antes2 = falhas.length;
for (const { arquivo, rota, metodo, op } of todas) {
  if (arquivo !== 'registradora.yaml') continue;
  if (rota.startsWith('/sim/')) continue;                 // superfície do simulador
  if (metodo !== 'get') {
    reprova('P1', arquivo, `${metodo.toUpperCase()} ${rota} (${op.operationId}) escreveria no registro`);
  }
}
if (falhas.length === antes2) ok('P1: a interface da registradora é somente leitura');

// -- P2: dado pessoal só entra pela porta do compliance ----------------------
const antes3 = falhas.length;
const PROIBIDOS = /^(cpf|cnpj|nome|nome_completo|email|e_mail|telefone|celular|endereco|logradouro|rg|conta|agencia|pix|documento|nascimento|car_numero|latitude|longitude|coordinates|geometria)$/i;
const ENTRADA_AUTORIZADA = new Set(['iniciarOnboarding']);
const varre = (no, caminho, visitar) => {
  if (!no || typeof no !== 'object') return;
  if (Array.isArray(no)) return no.forEach((n, i) => varre(n, `${caminho}[${i}]`, visitar));
  for (const [k, v] of Object.entries(no)) {
    visitar(k, v, caminho);
    varre(v, `${caminho}.${k}`, visitar);
  }
};
for (const [arquivo, doc] of Object.entries(docs)) {
  varre(doc.paths ?? {}, 'paths', (chave, valor, caminho) => {
    if (chave !== 'properties' || !valor || typeof valor !== 'object') return;
    const opId = (caminho.match(/paths\.([^.]+)\.(get|post|put|patch|delete)/) || [])[0];
    for (const prop of Object.keys(valor)) {
      if (!PROIBIDOS.test(prop)) continue;
      const trecho = JSON.stringify(doc.paths[caminho.split('.')[1]] ?? {});
      const autorizado = [...ENTRADA_AUTORIZADA].some((id) => trecho.includes(id));
      if (!autorizado) reprova('P2', arquivo, `campo "${prop}" em ${caminho} (${opId ?? 'rota'})`);
    }
  });
  varre(doc.components?.schemas ?? {}, 'components.schemas', (chave, valor, caminho) => {
    if (chave !== 'properties' || !valor || typeof valor !== 'object') return;
    for (const prop of Object.keys(valor)) {
      if (PROIBIDOS.test(prop)) reprova('P2', arquivo, `campo "${prop}" em ${caminho} (componente reutilizável)`);
    }
  });
}
if (falhas.length === antes3) ok('P2: nenhum campo identificante fora da porta de entrada do compliance');

// -- P4/P5: erro decorrente de princípio é declarado no contrato -------------
const antes4 = falhas.length;
const problema = docs['comum.yaml']?.components?.schemas?.Problema?.properties ?? {};
if (!problema.principio_violado) reprova('P5', 'comum.yaml', 'Problema sem campo principio_violado');
const semQuorum = JSON.stringify(docs['comum.yaml']?.components?.responses?.SemQuorum ?? {});
if (!semQuorum.includes('P4')) reprova('P4', 'comum.yaml', 'resposta SemQuorum não referencia P4');
if (falhas.length === antes4) ok('P4/P5: recusa por princípio é parte declarada do contrato');

// -- Coerência de enums entre a API e o esquema de dados ---------------------
const antes5 = falhas.length;
const ddl = readFileSync(join(RAIZ, 'docs/contracts/db/ops/020_dominios_e_enums.sql'), 'utf8')
  .replace(/--[^\n]*/g, '');   // comentários contêm parênteses e quebrariam o recorte
const enumDoDdl = (nome) => {
  const bloco = ddl.match(new RegExp(`CREATE TYPE ops\\.${nome} AS ENUM \\(([^)]*)\\)`, 's'));
  return bloco ? [...bloco[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort() : null;
};
const pares = [
  ['EstadoContrato', 'estado_contrato'],
  ['SituacaoConciliacao', 'situacao_conciliacao'],
  ['TipoDivergencia', 'tipo_divergencia'],
  ['Severidade', 'severidade'],
  ['ResultadoEudr', 'resultado_eudr'],
  ['EstadoLeitura', 'estado_leitura'],
  ['Commodity', 'commodity'],
];
for (const [api, sql] of pares) {
  const naApi = [...(docs['comum.yaml'].components.schemas[api]?.enum ?? [])].sort();
  const noBanco = enumDoDdl(sql);
  if (!noBanco) { reprova('P6', 'ops/020', `enum ops.${sql} não encontrado`); continue; }
  if (JSON.stringify(naApi) !== JSON.stringify(noBanco)) {
    reprova('P6', 'comum.yaml', `enum ${api} divergiu de ops.${sql}: API=${naApi} BD=${noBanco}`);
  }
}
if (falhas.length === antes5) ok('P6: enums da API e do esquema de dados coincidem');

if (falhas.length) {
  console.error('\nContratos NÃO conformes:');
  for (const f of falhas) console.error('  - ' + f);
  process.exit(1);
}
console.log('\ncontratos de API conformes');
