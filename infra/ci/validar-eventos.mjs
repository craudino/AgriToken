#!/usr/bin/env node
// Valida os esquemas de evento e o registro de auditoria: compila os esquemas,
// confere que catálogo e payloads cobrem-se mutuamente, valida cada exemplo
// embutido contra o envelope completo e reprova campo identificante (P2).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(RAIZ, 'docs/contracts/events');
const ler = (f) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));

const envelope = ler('envelope.schema.json');
const payloads = ler('payloads.schema.json');
const auditoria = ler('registro-auditoria.schema.json');
const catalogo = ler('catalogo.json');

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(envelope);
ajv.addSchema(payloads);
ajv.addSchema(auditoria);

const falhas = [];
const ok = (msg) => console.log(`OK  ${msg}`);

// -- Catálogo e payloads cobrem-se mutuamente -------------------------------
const tiposCatalogo = new Set(catalogo.eventos.map((e) => e.tipo));
const tiposPayload = new Set(Object.keys(payloads.$defs));
for (const t of tiposCatalogo) if (!tiposPayload.has(t)) falhas.push(`[contrato] tipo ${t} no catálogo sem payload`);
for (const t of tiposPayload) if (!tiposCatalogo.has(t)) falhas.push(`[contrato] payload ${t} fora do catálogo`);
if (!falhas.length) ok(`catálogo e payloads cobrem-se: ${tiposCatalogo.size} tipos`);

// -- Cada exemplo valida contra o envelope completo -------------------------
const antes = falhas.length;
const validarEnvelope = ajv.compile(envelope);
const canonico = (v) => {
  if (Array.isArray(v)) return '[' + v.map(canonico).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonico(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
};
for (const evento of catalogo.eventos) {
  const def = payloads.$defs[evento.tipo];
  const exemplos = def?.examples ?? [];
  if (!exemplos.length) { falhas.push(`[contrato] ${evento.tipo} sem exemplo`); continue; }
  const validarPayload = ajv.compile({ ...def, $schema: 'https://json-schema.org/draft/2020-12/schema' });
  for (const payload of exemplos) {
    if (!validarPayload(payload)) {
      falhas.push(`[contrato] exemplo de ${evento.tipo} inválido: ${ajv.errorsText(validarPayload.errors)}`);
      continue;
    }
    const env = {
      id: '00000000-0000-4000-8000-000000000000',
      tipo: evento.tipo,
      versao: 1,
      sujeito: { tipo: evento.sujeito, id: 'op-0001' },
      correlacao_id: '00000000-0000-4000-8000-000000000001',
      origem: 'services/core@1.0.0',
      ocorrido_em: '2026-09-18T12:00:00Z',
      registrado_em: '2026-09-18T12:00:01Z',
      payload,
      payload_hash: '0x' + createHash('sha256').update(canonico(payload)).digest('hex'),
      evidencia: evento.exige_evidencia
        ? [{ tipo: 'SNAPSHOT_REGISTRO', hash: '0x' + '11'.repeat(32) }]
        : [],
    };
    if (!validarEnvelope(env)) {
      falhas.push(`[contrato] envelope de ${evento.tipo} inválido: ${ajv.errorsText(validarEnvelope.errors)}`);
    }
    if (evento.exige_evidencia && env.evidencia.length === 0) {
      falhas.push(`[P5] ${evento.tipo} exige evidência e o exemplo não traz`);
    }
  }
}
if (falhas.length === antes) ok('todos os exemplos validam contra envelope e payload');

// -- P2: nenhum campo identificante em payload nem no registro de auditoria --
const antes2 = falhas.length;
const PROIBIDOS = /^(cpf|cnpj|nome|nome_completo|email|e_mail|telefone|celular|endereco|logradouro|rg|conta|agencia|pix|documento|nascimento|car_numero|latitude|longitude|coordinates|geometria|poligono)$/i;
const varrer = (no, caminho, arquivo) => {
  if (!no || typeof no !== 'object') return;
  if (Array.isArray(no)) return no.forEach((n, i) => varrer(n, `${caminho}[${i}]`, arquivo));
  for (const [k, v] of Object.entries(no)) {
    if (k === 'properties' && v && typeof v === 'object') {
      for (const prop of Object.keys(v)) {
        if (PROIBIDOS.test(prop)) falhas.push(`[P2] ${arquivo}: campo "${prop}" em ${caminho}`);
      }
    }
    varrer(v, `${caminho}.${k}`, arquivo);
  }
};
varrer(payloads.$defs, '$defs', 'payloads.schema.json');
varrer(auditoria.properties, 'properties', 'registro-auditoria.schema.json');

// Os exemplos também são varridos: um valor pode carregar PII mesmo com o
// campo bem-nomeado.
const REGEX_PII = [
  { nome: 'CPF', re: /(^|[^0-9])[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}([^0-9]|$)/ },
  { nome: 'CNPJ', re: /(^|[^0-9])[0-9]{2}\.[0-9]{3}\.[0-9]{3}\/[0-9]{4}-[0-9]{2}([^0-9]|$)/ },
  { nome: 'e-mail', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
];
for (const [tipo, def] of Object.entries(payloads.$defs)) {
  const texto = JSON.stringify(def.examples ?? []);
  for (const { nome, re } of REGEX_PII) {
    if (re.test(texto)) falhas.push(`[P2] exemplo de ${tipo} contém padrão de ${nome}`);
  }
}
if (falhas.length === antes2) ok('P2: nenhum campo nem exemplo com padrão identificante');

// -- P6: a canonicalização do JS coincide com a do banco --------------------
const antes3 = falhas.length;
const casos = [
  ['{"b":1,"a":{"d":4,"c":[3,2]}}', '{"a":{"c":[3,2],"d":4},"b":1}'],
  ['{"z":null,"a":true}', '{"a":true,"z":null}'],
];
for (const [entrada, esperado] of casos) {
  const obtido = canonico(JSON.parse(entrada));
  if (obtido !== esperado) falhas.push(`[P6] canonicalização divergiu: ${obtido} != ${esperado}`);
}
if (falhas.length === antes3) ok('P6: canonicalização do barramento coincide com a do banco');

// -- Produtores do catálogo existem como agentes ----------------------------
const antes4 = falhas.length;
const AGENTES = new Set(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']);
for (const e of catalogo.eventos) {
  if (!AGENTES.has(e.produtor)) falhas.push(`[contrato] ${e.tipo}: produtor ${e.produtor} não é agente conhecido`);
  for (const c of e.consumidores) {
    if (!AGENTES.has(c)) falhas.push(`[contrato] ${e.tipo}: consumidor ${c} não é agente conhecido`);
    if (c === e.produtor) falhas.push(`[contrato] ${e.tipo}: produtor consome o próprio evento`);
  }
}
if (falhas.length === antes4) ok('fronteiras de produção e consumo consistentes com os sete agentes');

if (falhas.length) {
  console.error('\nEsquemas de evento NÃO conformes:');
  for (const f of falhas) console.error('  - ' + f);
  process.exit(1);
}
console.log('\nesquemas de evento conformes');
