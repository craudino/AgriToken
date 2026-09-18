#!/usr/bin/env node
// SMC-003 — fronteira regulatória (P7) verificada no código-fonte, não só nas
// ABIs. Em G1, E1 e o red team apontaram que a verificação de P7 alcançava
// apenas seis interfaces Solidity, deixando de fora justamente os serviços,
// onde novação, interposição e promessa de rendimento de fato ocorreriam. O
// CLAUDE.md afirmava que o controle existia; era verdade para as interfaces e
// falso para o resto.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ALVOS = ['services', 'apps', 'contracts', 'infra'];
const EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.jsx', '.sol', '.sql', '.json', '.md', '.yaml', '.yml']);
const IGNORAR = /(^|\/)(node_modules|dist|build|\.next|coverage|artifacts|cache|typechain)(\/|$)/;

const arquivos = [];
const varrer = (dir) => {
  if (!existsSync(dir)) return;
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    const rel = relative(RAIZ, caminho);
    if (IGNORAR.test(rel)) continue;
    if (statSync(caminho).isDirectory()) varrer(caminho);
    else if (EXT.has(extname(nome))) arquivos.push(caminho);
  }
};
for (const alvo of ALVOS) varrer(join(RAIZ, alvo));

// Este próprio arquivo e os documentos que discutem a fronteira citam os
// padrões proibidos por necessidade. Discutir a proibição não é violá-la.
const ISENTOS = new Set([
  'infra/ci/validar-p7.mjs',
  'infra/ci/validar-abis.mjs',
]);

const falhas = [];
const ok = (m) => console.log(`OK  ${m}`);

// 1. Identificadores que denunciam travessia de fronteira.
const IDENTIFICADORES = [
  { re: /\b(function|const|async|def)\s+(custodiar|custody|guardarAtivo|depositarAtivo)\w*/i, o: 'custódia de ativo de terceiro' },
  { re: /\b(function|const|async)\s+(novar|novacao|substituirObrigacao)\w*/i, o: 'novação' },
  { re: /\b(function|const|async)\s+(assumirContraparte|interporContraparte|garantirLiquidacao)\w*/i, o: 'interposição como contraparte' },
  { re: /\b(function|const|async)\s+(prometerRendimento|garantirRetorno|distribuirRendimento|pagarRendimento)\w*/i, o: 'promessa de rendimento' },
  { re: /\b(function|const|async)\s+(escreverNoRegistro|atualizarRegistro|corrigirRegistro|sobreporRegistro)\w*/i, o: 'escrita no registro (P1)' },
];

// 2. Promessa de rendimento em texto exibido. O red team lê os nomes e os
//    textos, não as intenções: a expectativa jurídica nasce do que se exibe.
const TEXTO_PROIBIDO = [
  { re: /rentabilidade\s+(garantida|assegurada)/i, o: 'promessa de rentabilidade' },
  { re: /retorno\s+(garantido|assegurado)/i, o: 'promessa de retorno' },
  { re: /rendimento\s+(garantido|assegurado|mínimo)/i, o: 'promessa de rendimento' },
  { re: /investimento\s+sem\s+risco/i, o: 'negação de risco' },
  { re: /lucro\s+(garantido|certo)/i, o: 'promessa de lucro' },
];

// 3. Escrita na registradora: a interface é somente leitura, e o cliente
//    também precisa ser.
const ESCRITA_REGISTRO = /registradora[^\n]{0,80}\.(post|put|patch|delete)\s*\(/i;

for (const arquivo of arquivos) {
  const rel = relative(RAIZ, arquivo);
  if (ISENTOS.has(rel)) continue;
  const conteudo = readFileSync(arquivo, 'utf8');
  const linhas = conteudo.split('\n');
  linhas.forEach((linha, i) => {
    const n = i + 1;
    if (/^\s*(\/\/|\*|--|#)/.test(linha)) return;   // comentário: discutir não é fazer
    for (const { re, o } of IDENTIFICADORES) {
      if (re.test(linha)) falhas.push(`[P7] ${rel}:${n} — ${o}: ${linha.trim().slice(0, 90)}`);
    }
    for (const { re, o } of TEXTO_PROIBIDO) {
      if (re.test(linha)) falhas.push(`[P7] ${rel}:${n} — ${o}: ${linha.trim().slice(0, 90)}`);
    }
    if (ESCRITA_REGISTRO.test(linha)) {
      falhas.push(`[P1] ${rel}:${n} — escrita na registradora: ${linha.trim().slice(0, 90)}`);
    }
  });
}
ok(`P7: ${arquivos.length} arquivos de services/, apps/, contracts/ e infra/ varridos`);
if (!falhas.length) ok('P7: nenhum identificador nem texto de travessia de fronteira');

// 4. A afirmação do CLAUDE.md precisa ser verdadeira. Se o validador deixar de
//    varrer os serviços, este teste cai junto — e não silenciosamente.
const claude = readFileSync(join(RAIZ, 'CLAUDE.md'), 'utf8');
if (/P7/.test(claude) && !arquivos.some((f) => relative(RAIZ, f).startsWith('services'))) {
  // services/ ainda pode estar vazio antes da Fase 1; só falha se houver código
  // e ele não estiver sendo varrido.
  const temCodigo = existsSync(join(RAIZ, 'services')) &&
    readdirSync(join(RAIZ, 'services')).some((d) =>
      existsSync(join(RAIZ, 'services', d, 'src')));
  if (temCodigo) falhas.push('[P7] há código em services/ fora do alcance da varredura');
}

if (falhas.length) {
  console.error('\nFronteira regulatória NÃO conforme:');
  for (const f of falhas) console.error('  - ' + f);
  process.exit(1);
}
console.log('\nfronteira regulatória conforme');
