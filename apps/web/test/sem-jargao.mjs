#!/usr/bin/env node
// Aceite de W6: nenhuma palavra de sistema na tela do produtor.
//
// E7 aponta que o produtor abandona fluxo com jargão. A regra não sobrevive sem
// medição: jargão volta a aparecer a cada alteração, e ninguém percebe até o
// teste de usabilidade seguinte.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROIBIDAS = [
  'token', 'on-chain', 'onchain', 'blockchain', 'hash', 'oráculo', 'oraculo',
  'quórum', 'quorum', 'smart contract', 'wallet', 'carteira digital', 'ERC-3525',
  'espelho', 'espelhamento', 'conciliação', 'conciliacao', 'âncora', 'ancora',
];

// Extrai apenas o texto exibido: conteúdo entre tags e strings de atributo
// visível. Comentário de código pode citar o jargão — explicar a regra não é
// violá-la.
const textoVisivel = (fonte) => {
  const semComentarios = fonte
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');
  const trechos = [];
  for (const m of semComentarios.matchAll(/>([^<>{}]{3,})</g)) trechos.push(m[1]);
  for (const m of semComentarios.matchAll(/(?:placeholder|title|aria-label)="([^"]+)"/g)) trechos.push(m[1]);
  return trechos.join('\n');
};

const arquivos = [];
const varrer = (dir) => {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) varrer(caminho);
    else if (/\.(tsx|jsx)$/.test(nome)) arquivos.push(caminho);
  }
};
varrer(join(RAIZ, 'app/produtor'));

const falhas = [];
for (const arquivo of arquivos) {
  const texto = textoVisivel(readFileSync(arquivo, 'utf8')).toLowerCase();
  for (const palavra of PROIBIDAS) {
    if (texto.includes(palavra.toLowerCase())) {
      falhas.push(`${arquivo.replace(RAIZ + '/', '')}: "${palavra}" aparece no texto exibido ao produtor`);
    }
  }
}

// Contagem de decisões, não de telas: três etapas com sete escolhas cada é pior
// que cinco etapas com uma escolha cada.
const fonteProdutor = arquivos.map((a) => readFileSync(a, 'utf8')).join('\n');
const passos = (fonteProdutor.match(/className="passo/g) ?? []).length;
const botoes = (fonteProdutor.match(/<button/g) ?? []).length;
const campos = (fonteProdutor.match(/<(input|select|textarea)/g) ?? []).length;
const decisoes = botoes + campos;

console.log(`fluxo do produtor: ${passos} etapas, ${decisoes} decisões (${botoes} botões, ${campos} campos)`);
if (passos > 3) falhas.push(`fluxo tem ${passos} etapas decisórias; o limite de W6 é três`);
if (decisoes > 5) falhas.push(`fluxo pede ${decisoes} decisões; contar telas em vez de decisões é o erro clássico`);

if (falhas.length) {
  console.error('\nInterface do produtor NÃO conforme:');
  for (const f of falhas) console.error('  - ' + f);
  process.exit(1);
}
console.log('OK  W6: nenhuma palavra de sistema no texto do produtor, dentro do limite de decisões');
