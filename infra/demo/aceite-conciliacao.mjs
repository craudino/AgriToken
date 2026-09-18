#!/usr/bin/env node
// Teste de aceite de W2: injetar cada tipo do catálogo e verificar se o sistema
// detecta, com latência medida. O briefing chama este de o teste mais importante
// do MVP, e é ele que responde à lacuna informacional nº 1.
//
// Um contrato por tipo, de propósito: congelamento em um não pode mascarar a
// detecção no outro.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const CORE = process.env.URL_CORE ?? 'http://127.0.0.1:3003';
const COMPLIANCE = process.env.URL_COMPLIANCE ?? 'http://127.0.0.1:3001';
const REG = process.env.URL_REGISTRADORA ?? 'http://127.0.0.1:3005';
const OPS = process.env.OPS_URL ?? 'postgres://cpr_ops_app:dev_ops@127.0.0.1:5440/cpr_ops';

import { post, get, registrarComoEmitente } from './cliente.mjs';

const enderecos = JSON.parse(readFileSync('infra/enderecos.json', 'utf8'));
const pool = new pg.Pool({ connectionString: OPS });

const TIPOS_REGISTRO = [
  'TITULO_BAIXADO_NO_REGISTRO', 'CESSAO_NAO_REFLETIDA', 'VALOR_FACE_ALTERADO',
  'QUANTIDADE_ALTERADA', 'VENCIMENTO_ALTERADO', 'GARANTIA_ALTERADA',
  'ONUS_OU_GRAVAME_NAO_REFLETIDO', 'TITULO_INEXISTENTE_NO_REGISTRO',
  'ESTADO_DIVERGENTE', 'HASH_DOCUMENTAL_DIVERGENTE',
];
const TIPOS_TOKEN = ['TRANSFERENCIA_SEM_CESSAO', 'FRACIONAMENTO_NAO_REFLETIDO'];
// TOKEN_AUSENTE_PARA_REGISTRO e DUPLICIDADE_DE_ANCORA têm tratamento próprio.

let seq = 0;
const novoProdutor = async () => {
  seq++;
  const base = String(100000000 + seq * 7919).padStart(9, '0').slice(0, 9).split('').map(Number);
  const dv = (nums, peso) => { const s = nums.reduce((a, n, i) => a + n * (peso - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(base, 10), d2 = dv([...base, d1], 11);
  const documento = [...base, d1, d2].join('');
  const p = await post(`${COMPLIANCE}/onboarding`, {
    tipo_pessoa: 'PF', documento, nome: `Produtor Teste ${seq}`,
    car_numero: `MG-314590${seq % 10}-A${seq}B2`, base_legal: 'CONTRATO',
    porte: 'PEQUENO', uf: 'MG', municipio_ibge: '3145901',
  });
  if (p.situacao !== 'APROVADO') return novoProdutor();       // KYC reprovado: tenta outro
  return p.produtor_ref;
};

const prepararContrato = async (comGarantia = true) => {
  const ref = await novoProdutor();
  await post(`${COMPLIANCE}/participantes/habilitar`, { produtor_ref: ref, endereco: enderecos.contas.credor1 });
  const { rows: p } = await pool.query('SELECT id FROM ops.produtor WHERE ref_opaca=$1', [Buffer.from(ref, 'hex')]);
  const talhaoId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO ops.talhao (id, produtor_id, car_ref, car_hash, area_declarada_ha, commodity)
     VALUES ($1,$2,$3, digest($4,'sha256'), 12.5, 'CAFE_ARABICA')`,
    [talhaoId, p[0].id, crypto.randomUUID(), `car-${talhaoId}`]);

  const c = await post(`${CORE}/contratos`, {
    produtor_ref: ref, commodity: 'CAFE_ARABICA', quantidade_sacas: '500', safra: '2026/2027',
    vencimento: '2027-07-31', valor_face: { valor: '750000.00', moeda: 'BRL' },
    talhoes: [{ talhao_id: talhaoId, sacas_alocadas: '500' }],
  });
  if (comGarantia) {
    await post(`${CORE}/contratos/${c.id}/garantias`, {
      tipo: 'PENHOR_SAFRA', nivel_waterfall: 1, valor_declarado: '400000.00', talhao_id: talhaoId,
      registro_publico_ref: `AVERB-${crypto.randomUUID().slice(0, 8)}`, oponibilidade: 'AVERBADA', averbada_em: '2026-09-01',
    });
  }
  await post(`${CORE}/contratos/${c.id}/verificacao`);
  await registrarComoEmitente(REG, {
    registro_id: c.registro_id, produtor_ref: ref,
    quantidade_sacas: '500', valor_face: '750000.00', vencimento: '2027-07-31',
  }, comGarantia ? [{ tipo: 'PENHOR_SAFRA', referencia: 'AVERB', valor: { valor: '400000.00', moeda: 'BRL' } }] : []);
  await post(`${CORE}/contratos/${c.id}/registro`);
  await post(`${CORE}/contratos/${c.id}/espelho`);
  await post(`${CORE}/conciliacao/executar`, { contrato_id: c.id });
  return { ...c, produtor_ref: ref, talhaoId };
};

const resultados = [];

// ---- tipos injetáveis no registro ----------------------------------------
for (const tipo of TIPOS_REGISTRO) {
  const c = await prepararContrato();
  const t0 = Date.now();
  await post(`${REG}/sim/injecoes`, { tipo, entidade: 'REG-SIM', registro_id: c.registro_id });
  await post(`${CORE}/conciliacao/executar`, { contrato_id: c.id });
  const sit = await get(`${CORE}/contratos/${c.id}/conciliacao`);
  const d = sit.divergencias.find((x) => x.tipo === tipo);
  resultados.push({
    tipo, lado: 'REGISTRO', detectado: Boolean(d),
    latencia_ms: d ? Date.now() - t0 : null,
    congelou: d?.congelou_contrato ?? false,
    situacao: sit.situacao,
  });
}

// ---- tipos que só existem no lado do token --------------------------------
const { ethers } = await import('ethers');
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL ?? 'http://127.0.0.1:8545');
const credor = new ethers.Wallet('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba', provider);
const abiEspelho = JSON.parse(readFileSync('artifacts/out/contracts/src/EspelhoCPR.sol/EspelhoCPR.json', 'utf8')).abi;
const espelho = new ethers.Contract(enderecos.enderecos.espelhoCPR, abiEspelho, credor);

for (const tipo of TIPOS_TOKEN) {
  const c = await prepararContrato();
  const { rows } = await pool.query('SELECT token_id FROM ops.contrato WHERE id=$1', [c.id]);
  // Habilita um segundo credor e move fração para ele, sem cessão no registro.
  await post(`${COMPLIANCE}/participantes/habilitar`, { produtor_ref: c.produtor_ref, endereco: enderecos.contas.credor2 });
  const t0 = Date.now();
  await post(`${REG}/sim/injecoes`, { tipo, entidade: 'REG-SIM', registro_id: c.registro_id });
  const tx = await espelho['transferFrom(uint256,address,uint256)'](
    BigInt(rows[0].token_id), enderecos.contas.credor2, 1_000_000n);
  await tx.wait();
  await post(`${CORE}/conciliacao/executar`, { contrato_id: c.id });
  const sit = await get(`${CORE}/contratos/${c.id}/conciliacao`);
  const d = sit.divergencias.find((x) => ['TRANSFERENCIA_SEM_CESSAO', 'FRACIONAMENTO_NAO_REFLETIDO'].includes(x.tipo));
  resultados.push({
    tipo, lado: 'TOKEN', detectado: Boolean(d), detectado_como: d?.tipo,
    latencia_ms: d ? Date.now() - t0 : null, congelou: d?.congelou_contrato ?? false, situacao: sit.situacao,
  });
}

// ---- registro sem espelho -------------------------------------------------
{
  const t0 = Date.now();
  await post(`${REG}/sim/titulos`, {
    entidade: 'REG-SIM', registro_id: `CPR-ORFAO-${Date.now()}`, estado: 'VIGENTE',
    titular_ref: 'a'.repeat(32), emitente_ref: 'a'.repeat(32), commodity: 'CAFE_ARABICA',
    quantidade: '100', valor_face: { valor: '150000.00', moeda: 'BRL' },
    vencimento: '2027-07-31', garantias: [], onus: [], cessoes: [],
  });
  await post(`${CORE}/conciliacao/executar`, {});
  const abertas = await get(`${CORE}/conciliacao/divergencias?estado=ABERTA`);
  const d = abertas.find((x) => x.tipo === 'TOKEN_AUSENTE_PARA_REGISTRO');
  resultados.push({ tipo: 'TOKEN_AUSENTE_PARA_REGISTRO', lado: 'REGISTRO', detectado: Boolean(d),
                    latencia_ms: d ? Date.now() - t0 : null, congelou: false, situacao: 'n/a' });
}

// ---- duplicidade de âncora: detectada por prevenção ------------------------
{
  const c = await prepararContrato();
  const { rows } = await pool.query(
    "SELECT encode(registro_hash_ancora,'hex') a FROM ops.contrato WHERE id=$1", [c.id]);
  let revertido = false, erro = null;
  try {
    await espelho.emitirEspelho('0x' + rows[0].a, enderecos.contas.credor1, 1n, 1n, ethers.ZeroHash);
  } catch (e) { revertido = true; erro = String(e.message).slice(0, 80); }
  resultados.push({
    tipo: 'DUPLICIDADE_DE_ANCORA', lado: 'TOKEN', detectado: revertido,
    latencia_ms: 0, congelou: false, situacao: 'PREVENIDA',
    observacao: 'Impossível por construção: o contrato reverte a segunda emissão (P3). ' +
                'Detecção por prevenção, não por conciliação. ' + (erro ?? ''),
  });
}

// ---- relatório ------------------------------------------------------------
const total = resultados.length;
const detectados = resultados.filter((r) => r.detectado).length;
console.log('\n=== Placar de detecção de divergências ===\n');
console.table(resultados.map((r) => ({
  tipo: r.tipo, lado: r.lado, detectado: r.detectado ? 'sim' : 'NÃO',
  latencia_ms: r.latencia_ms, congelou: r.congelou ? 'sim' : '-', situacao: r.situacao,
})));
const naoDetectados = resultados.filter((r) => !r.detectado).map((r) => r.tipo);
console.log(`\ndetectados ${detectados}/${total}` + (naoDetectados.length ? ` — FALHOU em: ${naoDetectados.join(', ')}` : ''));
for (const r of resultados.filter((x) => x.observacao)) console.log(`nota (${r.tipo}): ${r.observacao}`);

await pool.end();
process.exit(detectados === total ? 0 : 1);
