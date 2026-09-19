#!/usr/bin/env node
// Aceite da autorização: prova que a recusa acontece, e não que o código existe.
//
// Ordem dos casos pensada para o que um adversário tentaria primeiro: entrar
// sem nada, entrar com token de outro perfil, forjar assinatura, alterar o
// algoritmo e alcançar a superfície de simulação.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { emitirToken } = require('../../packages/nucleo/dist/auth.js');

const CORE = 'http://127.0.0.1:3003';
const COMPLIANCE = 'http://127.0.0.1:3001';
const REG = 'http://127.0.0.1:3005';

const casos = [];
const registrar = (nome, esperado, obtido, detalhe = '') =>
  casos.push({ nome, esperado, obtido, ok: esperado === obtido, detalhe });

const bater = async (url, { token, metodo = 'GET', corpo } = {}) => {
  const r = await fetch(url, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  return r.status;
};

const tokenCredor = emitirToken({ perfil: 'credor', sub: 'credor@teste' });
const tokenOperador = emitirToken({ perfil: 'operador-conciliacao', sub: 'op@teste', operador: 'OP-CONCILIACAO-07' });
const tokenPrivacidade = emitirToken({ perfil: 'operador-privacidade', sub: 'dpo@teste' });
const tokenDemo = emitirToken({ perfil: 'demonstracao', sub: 'roteiro@teste' });

// 1. Sem credencial nenhuma.
registrar('sem token em GET /contratos', 401, await bater(`${CORE}/contratos`));
registrar('sem token em POST /contratos', 401, await bater(`${CORE}/contratos`, { metodo: 'POST', corpo: {} }));
registrar('sem token em GET /tratamentos', 401, await bater(`${COMPLIANCE}/tratamentos`));
registrar('sem token na eliminação de titular', 401,
  await bater(`${COMPLIANCE}/titulares/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/eliminacao`,
    { metodo: 'POST', corpo: { canal: 'x', solicitante: 'y' } }));

// 2. As duas sondas são públicas de propósito, e são as únicas.
registrar('GET /saude sem token', 200, await bater(`${CORE}/saude`));
registrar('GET /saude/pronto sem token', 200, await bater(`${CORE}/saude/pronto`));
registrar('diagnóstico detalhado sem token', 401, await bater(`${CORE}/diagnostico`));

// A sonda pública não pode entregar estado interno a quem não se identificou.
const corpoSonda = await (await fetch(`${CORE}/saude/pronto`)).json();
registrar('sonda pública não vaza estado interno', 'só o veredicto',
  Object.keys(corpoSonda).join(',') === 'pronto' ? 'só o veredicto' : `vazou: ${Object.keys(corpoSonda)}`);

// 3. Token válido, escopo errado. É o caso que separa autenticação de
//    autorização, e o que a maioria das APIs erra.
registrar('credor tentando originar contrato', 403,
  await bater(`${CORE}/contratos`, { token: tokenCredor, metodo: 'POST', corpo: {} }));
registrar('credor tentando reconciliar divergência', 403,
  await bater(`${CORE}/conciliacao/divergencias/00000000-0000-4000-8000-000000000000/reconciliacao`,
    { token: tokenCredor, metodo: 'POST', corpo: {} }));
registrar('credor tentando eliminar titular', 403,
  await bater(`${COMPLIANCE}/titulares/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/eliminacao`,
    { token: tokenCredor, metodo: 'POST', corpo: { canal: 'x', solicitante: 'y' } }));
registrar('operador de privacidade tentando ler carteira', 403,
  await bater(`${CORE}/contratos`, { token: tokenPrivacidade }));
registrar('operador de conciliação tentando injetar divergência', 403,
  await bater(`${REG}/sim/injecoes`, { token: tokenOperador, metodo: 'POST', corpo: {} }));

// 4. Escopo certo passa.
registrar('credor lendo a carteira', 200, await bater(`${CORE}/contratos`, { token: tokenCredor }));
registrar('operador executando conciliação', 201,
  await bater(`${CORE}/conciliacao/executar`, { token: tokenOperador, metodo: 'POST', corpo: {} }));

// 5. Token forjado e token adulterado.
const [cab, corpo] = tokenCredor.split('.');
registrar('assinatura trocada', 401, await bater(`${CORE}/contratos`, { token: `${cab}.${corpo}.assinaturaInventada` }));

const corpoElevado = Buffer.from(JSON.stringify({
  sub: 'atacante', perfil: 'demonstracao', escopos: ['contrato:escrever', 'pii:eliminar'],
  exp: Math.floor(Date.now() / 1000) + 3600, jti: 'x',
})).toString('base64url');
registrar('escopos elevados no payload, assinatura antiga', 401,
  await bater(`${CORE}/contratos`, { token: `${cab}.${corpoElevado}.${tokenCredor.split('.')[2]}` }));

const semAlg = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
registrar('alg: none', 401, await bater(`${CORE}/contratos`, { token: `${semAlg}.${corpoElevado}.` }));

const expirado = emitirToken({ perfil: 'credor', sub: 'credor@teste', ttlSegundos: -10 });
registrar('token expirado', 401, await bater(`${CORE}/contratos`, { token: expirado }));

// 6. Superfície de simulação: vale em desenvolvimento, e o token que a habilita
//    é recusado fora dele. O segundo caso é verificado na biblioteca, porque
//    depende da variável de ambiente do processo servidor.
// O que se afirma aqui é que a AUTORIZAÇÃO passou, não que a operação deu
// certo: 404 (título inexistente) é resposta de negócio e serve de prova. A
// primeira versão deste caso comparava o status consigo mesmo e passaria
// sempre — teste que não pode falhar não é teste.
const statusSimulador = await bater(`${REG}/sim/injecoes`, {
  token: tokenDemo, metodo: 'POST',
  corpo: { tipo: 'VALOR_FACE_ALTERADO', entidade: 'REG-SIM', registro_id: 'INEXISTENTE' },
});
registrar('perfil de demonstração alcança o simulador em desenvolvimento',
  'autorizado', statusSimulador === 401 || statusSimulador === 403 ? 'recusado' : 'autorizado',
  `status ${statusSimulador}`);

const { verificarToken } = require('../../packages/nucleo/dist/auth.js');
process.env.AMBIENTE = 'homologacao';
let recusado = false;
try { verificarToken(tokenDemo); } catch { recusado = true; }
process.env.AMBIENTE = 'desenvolvimento';
registrar('perfil de demonstração fora de desenvolvimento', true, recusado);

// ---- relatório ------------------------------------------------------------
console.table(casos.map((c) => ({
  caso: c.nome, esperado: c.esperado, obtido: c.obtido, resultado: c.ok ? 'ok' : 'FALHOU',
})));
const falhas = casos.filter((c) => !c.ok);
console.log(`\n${casos.length - falhas.length}/${casos.length} casos conformes`);
process.exit(falhas.length ? 1 : 0);
