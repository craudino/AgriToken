#!/usr/bin/env node
// Compila as interfaces de W1, congela as ABIs em docs/contracts/abi/ e
// verifica as fronteiras que precisam existir como código, não como promessa.
//
//   node infra/ci/validar-abis.mjs --gerar   grava as ABIs (mudança de contrato)
//   node infra/ci/validar-abis.mjs           compara e reprova divergência
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FONTES = join(RAIZ, 'contracts/interfaces');
const ABIS = join(RAIZ, 'docs/contracts/abi');
const GERAR = process.argv.includes('--gerar');

const arquivos = readdirSync(FONTES).filter((f) => f.endsWith('.sol'));
const entrada = {
  language: 'Solidity',
  sources: Object.fromEntries(arquivos.map((f) => [f, { content: readFileSync(join(FONTES, f), 'utf8') }])),
  settings: {
    outputSelection: { '*': { '*': ['abi'] } },
    optimizer: { enabled: true, runs: 200 },
  },
};

const resolver = (caminho) => {
  const alvo = join(FONTES, basename(caminho));
  return existsSync(alvo) ? { contents: readFileSync(alvo, 'utf8') } : { error: `não encontrado: ${caminho}` };
};

const saida = JSON.parse(solc.compile(JSON.stringify(entrada), { import: resolver }));
const erros = (saida.errors ?? []).filter((e) => e.severity === 'error');
if (erros.length) {
  for (const e of erros) console.error(e.formattedMessage);
  process.exit(1);
}
for (const aviso of (saida.errors ?? []).filter((e) => e.severity === 'warning')) {
  console.warn('aviso:', aviso.formattedMessage.trim().split('\n')[0]);
}

const falhas = [];
const ok = (msg) => console.log(`OK  ${msg}`);

// Fronteiras verificadas sobre a ABI compilada ------------------------------
// P7: a plataforma não custodia ativo virtual de terceiro, não se interpõe
// como contraparte e não promete rendimento. Um nome de função na lista abaixo
// é sinal de que alguém atravessou a fronteira sem perceber.
const PROIBIDOS = [
  /^deposit/i, /^saque$/i, /^sacar/i, /^withdraw/i, /^custodiar/i, /^custody/i,
  /^swap/i, /^trocar/i, /^stake/i, /^yield/i, /^render/i, /^rendimento/i,
  /^novar/i, /^novacao/i, /^assumirContraparte/i, /^garantirRetorno/i,
  /^resgatar/i, /^redeem/i, /^emprestar/i, /^lend/i, /^liquidarPosicao/i,
  /atualizarRegistro/i, /escreverNoRegistro/i, /corrigirRegistro/i,
];

const contratos = {};
for (const [arquivo, defs] of Object.entries(saida.contracts ?? {})) {
  for (const [nome, def] of Object.entries(defs)) contratos[nome] = { arquivo, abi: def.abi };
}

for (const [nome, { abi }] of Object.entries(contratos)) {
  for (const item of abi) {
    if (item.type === 'function') {
      for (const padrao of PROIBIDOS) {
        if (padrao.test(item.name)) falhas.push(`[P7] ${nome}.${item.name} casa com fronteira proibida ${padrao}`);
      }
    }
    // P2: função mutante com parâmetro de texto livre é a porta de entrada de
    // dado pessoal na cadeia. Interfaces de W1 trafegam hash, nunca texto.
    if (item.type === 'function' && !['view', 'pure'].includes(item.stateMutability)) {
      for (const p of item.inputs ?? []) {
        if (p.type === 'string' || p.type === 'string[]') {
          falhas.push(`[P2] ${nome}.${item.name} recebe ${p.type} "${p.name}" em função mutante`);
        }
      }
    }
    if (item.type === 'receive' || item.type === 'fallback') {
      falhas.push(`[P7] ${nome} declara ${item.type}: a plataforma não recebe valor`);
    }
  }
}
if (!falhas.length) ok('P7: nenhuma função de custódia, novação ou promessa de rendimento na ABI');
const antesP2 = falhas.length;
if (antesP2 === 0) ok('P2: nenhuma função mutante recebe texto livre');

// O cofre de garantias não pode ser pagável em hipótese alguma.
const cofre = contratos['ICofreGarantias'];
if (cofre) {
  const pagaveis = cofre.abi.filter((i) => i.stateMutability === 'payable').map((i) => i.name);
  if (pagaveis.length) falhas.push(`[P7] ICofreGarantias tem função payable: ${pagaveis.join(', ')}`);
  else ok('P7: o cofre de garantias registra vínculos e não movimenta valor');
}

// P1: o espelho precisa expor congelamento e não pode expor rota de escrita
// no registro. A presença de um e a ausência do outro são o contrato.
const espelho = contratos['IEspelhoCPR'];
if (espelho) {
  const nomes = espelho.abi.filter((i) => i.type === 'function').map((i) => i.name);
  for (const exigida of ['congelar', 'descongelar', 'estaCongelado', 'emitirEspelho', 'baixar']) {
    if (!nomes.includes(exigida)) falhas.push(`[P1] IEspelhoCPR sem função ${exigida}`);
  }
  if (!falhas.some((f) => f.includes('IEspelhoCPR'))) {
    ok('P1: o espelho expõe congelamento por divergência e baixa por liquidação');
  }
}

// Congelamento das ABIs -----------------------------------------------------
if (!existsSync(ABIS)) mkdirSync(ABIS, { recursive: true });
for (const [nome, { abi }] of Object.entries(contratos)) {
  const destino = join(ABIS, `${nome}.json`);
  const texto = JSON.stringify(abi, null, 2) + '\n';
  if (GERAR) {
    writeFileSync(destino, texto);
    continue;
  }
  if (!existsSync(destino)) {
    falhas.push(`[P6] ABI congelada ausente para ${nome} — rode com --gerar e abra mudança de contrato`);
    continue;
  }
  if (readFileSync(destino, 'utf8') !== texto) {
    falhas.push(`[P6] ${nome}.json divergiu da interface Solidity: implementação e contrato saíram de sincronia`);
  }
}
if (GERAR) console.log(`ABIs gravadas em docs/contracts/abi/ (${Object.keys(contratos).length} interfaces)`);
else if (!falhas.some((f) => f.startsWith('[P6]'))) ok('P6: ABIs congeladas conferem com as interfaces Solidity');

if (falhas.length) {
  console.error('\nInterfaces NÃO conformes:');
  for (const f of falhas) console.error('  - ' + f);
  process.exit(1);
}
console.log('\ninterfaces de W1 conformes');
