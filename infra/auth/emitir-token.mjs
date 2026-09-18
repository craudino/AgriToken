#!/usr/bin/env node
// Emissor de token para desenvolvimento e ambiente de teste.
//
//   node infra/auth/emitir-token.mjs credor
//   node infra/auth/emitir-token.mjs operador-conciliacao --operador OP-CONCILIACAO-07
//   node infra/auth/emitir-token.mjs servico --sub services/core --ttl 86400
//
// Em produção quem emite é o provedor de identidade, não isto. O arquivo
// existe para que o ambiente de teste tenha credencial sem inventar um
// provedor, e o perfil `demonstracao` só vale com AMBIENTE=desenvolvimento.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { emitirToken, PERFIS, ambiente } = require('../../packages/nucleo/dist/auth.js');

const args = process.argv.slice(2);
const perfil = args[0];
const opcao = (nome, padrao) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 ? args[i + 1] : padrao;
};

if (!perfil || !PERFIS[perfil]) {
  console.error(`uso: node infra/auth/emitir-token.mjs <perfil> [--sub s] [--ttl seg] [--operador OP-X] [--ator-ref hex]`);
  console.error(`perfis: ${Object.keys(PERFIS).join(', ')}`);
  process.exit(1);
}

const token = emitirToken({
  perfil,
  sub: opcao('sub', `${perfil}@teste`),
  ttlSegundos: Number(opcao('ttl', 3600)),
  operador: opcao('operador'),
  ator_ref: opcao('ator-ref'),
});

if (args.includes('--json')) {
  console.log(JSON.stringify({ perfil, ambiente: ambiente(), escopos: PERFIS[perfil], token }, null, 2));
} else {
  console.log(token);
}
