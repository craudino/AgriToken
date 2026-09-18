#!/usr/bin/env node
// Varredura de PII na cadeia (aceite de W5). Fornecida por A5, instalada no CI
// por A7. Percorre TODOS os blocos e examina calldata, logs e tópicos — não
// apenas os eventos que o sistema decidiu decodificar, porque o vazamento que
// importa é justamente o que ninguém previu.
//
// Falha o build ao encontrar qualquer padrão. P2 não admite exceção: não
// existe direito à eliminação em livro imutável, e um vazamento não se recolhe.
import { JsonRpcProvider } from 'ethers';

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';

// Padrões de dado identificável. Texto ASCII em calldata é o vetor mais comum:
// alguém acrescenta um campo "observação" e o CPF entra junto.
const PADROES = [
  ['CPF', /(^|[^0-9])\d{3}\.?\d{3}\.?\d{3}-?\d{2}([^0-9]|$)/],
  ['CNPJ', /(^|[^0-9])\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}([^0-9]|$)/],
  ['e-mail', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['telefone', /\+?55\s?\d{2}\s?9?\d{4}-?\d{4}/],
  ['coordenada', /-?\d{1,2}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/],
];

/** Extrai qualquer trecho ASCII legível de um blob hexadecimal. */
const textoEmHex = (hex) => {
  const bytes = Buffer.from(hex.replace(/^0x/, ''), 'hex');
  let atual = '';
  const achados = [];
  for (const b of bytes) {
    if (b >= 0x20 && b <= 0x7e) atual += String.fromCharCode(b);
    else { if (atual.length >= 6) achados.push(atual); atual = ''; }
  }
  if (atual.length >= 6) achados.push(atual);
  return achados;
};

// Autoteste do detector. Um varredor quebrado passa silenciosamente e dá
// garantia falsa — que é pior que garantia nenhuma, como o painel apontou em
// G1. Antes de varrer a cadeia, o detector prova que detecta.
const autoteste = () => {
  const casos = [
    ['CPF', '0x' + Buffer.from('titular 529.982.247-25 contestou').toString('hex')],
    ['e-mail', '0x' + Buffer.from('contato produtor@fazenda.com.br').toString('hex')],
    ['telefone', '0x' + Buffer.from('ligar +5535999990000 amanha').toString('hex')],
    ['coordenada', '0x' + Buffer.from('ponto -21.5234567, -45.4712345 sede').toString('hex')],
  ];
  for (const [rotulo, hex] of casos) {
    const detectou = textoEmHex(hex).some((t) => PADROES.some(([r, re]) => r === rotulo && re.test(t)));
    if (!detectou) {
      console.error(`[P2] autoteste falhou: o detector não reconhece ${rotulo}. A varredura não vale nada.`);
      process.exit(2);
    }
  }
  const limpo = '0x' + Buffer.from('token 1 slot 1 hash 0xabc').toString('hex');
  if (textoEmHex(limpo).some((t) => PADROES.some(([, re]) => re.test(t)))) {
    console.error('[P2] autoteste falhou: o detector acusa dado limpo.');
    process.exit(2);
  }
  console.log('OK  autoteste do detector: 4 padrões reconhecidos, nenhum falso positivo');
};
autoteste();

const provider = new JsonRpcProvider(RPC);
const achados = [];
let blocos = 0, transacoes = 0, eventos = 0;

const examinar = (origem, hex) => {
  for (const trecho of textoEmHex(hex)) {
    for (const [rotulo, re] of PADROES) {
      if (re.test(trecho)) achados.push(`${origem}: ${rotulo} em "${trecho.slice(0, 60)}"`);
    }
  }
};

const ultimo = await provider.getBlockNumber();
for (let n = 0; n <= ultimo; n++) {
  const bloco = await provider.getBlock(n, true);
  if (!bloco) continue;
  blocos++;
  for (const hash of bloco.transactions) {
    const tx = await provider.getTransaction(hash);
    if (!tx) continue;
    transacoes++;
    examinar(`tx ${hash.slice(0, 12)} calldata`, tx.data);
    const recibo = await provider.getTransactionReceipt(hash);
    for (const log of recibo?.logs ?? []) {
      eventos++;
      examinar(`tx ${hash.slice(0, 12)} log.data`, log.data);
      for (const t of log.topics) examinar(`tx ${hash.slice(0, 12)} log.topic`, t);
    }
  }
}

console.log(`varredura: ${blocos} blocos, ${transacoes} transações, ${eventos} eventos`);
if (achados.length) {
  console.error('\n[P2] DADO PESSOAL NA CADEIA — build reprovado:');
  for (const a of achados) console.error('  - ' + a);
  console.error('\nA cadeia é imutável: um vazamento aqui não se recolhe.');
  process.exit(1);
}
console.log('OK  P2: nenhum padrão identificável em calldata, logs ou tópicos');
