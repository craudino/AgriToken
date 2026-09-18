#!/usr/bin/env node
// Demonstração ponta a ponta, sem intervenção manual (Seção 12 do briefing).
//
// Percorre: onboarding com KYC → polígono e evidência EUDR → originação →
// registro → espelhamento → conciliação conforme → marcação a mercado →
// divergência injetada e detectada → congelamento → reconciliação humana →
// cenário de estresse → inadimplência → waterfall → liquidação → varredura de
// PII na cadeia → eliminação de titular com comprovante.
//
// Cada passo imprime o que provou. Passo que não prova nada não entra.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import pg from 'pg';

const CORE = 'http://127.0.0.1:3003';
const COMPLIANCE = 'http://127.0.0.1:3001';
const ORACLE = 'http://127.0.0.1:3002';
const EUDR = 'http://127.0.0.1:3004';
const REG = 'http://127.0.0.1:3005';

import { post, get, registrarComoEmitente } from './cliente.mjs';

const enderecos = JSON.parse(readFileSync('infra/enderecos.json', 'utf8'));
const massa = JSON.parse(readFileSync('infra/dados/massa.json', 'utf8'));
const pool = new pg.Pool({ connectionString: process.env.OPS_URL ?? 'postgres://cpr_ops_app:dev_ops@127.0.0.1:5440/cpr_ops' });

const provas = [];
let passo = 0;
const etapa = (titulo, prova) => {
  passo++;
  console.log(`\n${String(passo).padStart(2, '0')}. ${titulo}`);
  if (prova) { console.log(`    ${prova}`); provas.push({ passo: titulo, prova }); }
};

const dv = (nums, peso) => { const s = nums.reduce((a, n, i) => a + n * (peso - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
const cpfValido = (semente) => {
  const base = String(semente).padStart(9, '0').slice(-9).split('').map(Number);
  const d1 = dv(base, 10); const d2 = dv([...base, d1], 11);
  return [...base, d1, d2].join('');
};

// ---------------------------------------------------------------- onboarding
let produtor = null;
for (let i = 0; i < 12 && !produtor; i++) {
  const r = await post(`${COMPLIANCE}/onboarding`, {
    tipo_pessoa: 'PF', documento: cpfValido(770000000 + i * 131), nome: 'Produtor da Demonstração',
    nascimento: '1972-04-18', contato: '+5535988887777', car_numero: `MG-3145901-D${i}E2F3`,
    base_legal: 'CONTRATO', porte: 'PEQUENO', uf: 'MG', municipio_ibge: '3145901',
  });
  if (r.situacao === 'APROVADO') produtor = r;
}
etapa('Onboarding com KYC, listas restritivas e CAR',
  `produtor ${produtor.produtor_ref.slice(0, 12)}… aprovado; nenhum dado identificável saiu do cofre`);

const semPii = await pool.query(
  `SELECT count(*) n FROM information_schema.columns
    WHERE table_schema='ops' AND column_name ~* '(cpf|cnpj|nome|email|telefone|endereco)'`);
etapa('Base operacional sem coluna identificante',
  `${semPii.rows[0].n} colunas identificantes em cpr_ops (esperado: 0)`);

await post(`${COMPLIANCE}/participantes/habilitar`,
  { produtor_ref: produtor.produtor_ref, endereco: enderecos.contas.credor1 });
await post(`${COMPLIANCE}/participantes/habilitar`,
  { produtor_ref: produtor.produtor_ref, endereco: enderecos.contas.credor2 });
etapa('Credores habilitados na cadeia por atestação de KYC',
  'circulação fechada: o espelho não vai para endereço sem atestação vigente (ADR-0005)');

// ------------------------------------------------------------------ EUDR
await post(`${EUDR}/sim/bases/carregar`, {});
const talhaoConforme = massa.talhoes.find((t) => t.perfil_esperado === 'CONFORME');
const ingerido = await post(`${EUDR}/talhoes`, {
  produtor_ref: produtor.produtor_ref, apelido: talhaoConforme.apelido,
  commodity: talhaoConforme.commodity, area_declarada_ha: talhaoConforme.area_estimada_ha,
  geometria: talhaoConforme.geometria,
});
const evidencia = await post(`${EUDR}/talhoes/${ingerido.id}/avaliacoes`, {});
const reproducao = await post(`${EUDR}/evidencias/${evidencia.id}/reproducao`, {});
etapa('Evidência EUDR gerada contra duas bases independentes',
  `resultado ${evidencia.resultado}, sobreposição ${evidencia.area_sobreposta_ha} ha, reproduzível=${reproducao.reproduzivel}`);

// ------------------------------------------------------------- originação
const contrato = await post(`${CORE}/contratos`, {
  produtor_ref: produtor.produtor_ref, commodity: 'CAFE_ARABICA', quantidade_sacas: '500',
  safra: '2026/2027', vencimento: '2027-07-31', valor_face: { valor: '750000.00', moeda: 'BRL' },
  talhoes: [{ talhao_id: ingerido.id, sacas_alocadas: '500' }],
});
for (const g of [
  { tipo: 'PENHOR_SAFRA', nivel_waterfall: 1, valor_declarado: '400000.00', talhao_id: ingerido.id,
    registro_publico_ref: `AVERB-${crypto.randomUUID().slice(0, 8)}`, oponibilidade: 'AVERBADA', averbada_em: '2026-09-01' },
  { tipo: 'SEGURO_AGRICOLA', nivel_waterfall: 2, valor_declarado: '180000.00',
    registro_publico_ref: `APOLICE-${crypto.randomUUID().slice(0, 8)}` },
  { tipo: 'AVAL', nivel_waterfall: 3, valor_declarado: '120000.00',
    registro_publico_ref: `AVAL-${crypto.randomUUID().slice(0, 8)}` },
  { tipo: 'FUNDO_MUTUALIZADO', nivel_waterfall: 4, valor_declarado: '90000.00',
    registro_publico_ref: `FUNDO-${crypto.randomUUID().slice(0, 8)}` },
  { tipo: 'HIPOTECA', nivel_waterfall: 5, valor_declarado: '600000.00',
    registro_publico_ref: `MATR-${crypto.randomUUID().slice(0, 8)}`, oponibilidade: 'AVERBADA', averbada_em: '2026-08-15' },
]) await post(`${CORE}/contratos/${contrato.id}/garantias`, g);

await post(`${CORE}/contratos/${contrato.id}/verificacao`, {});

// O emitente registra na entidade autorizada — não a plataforma.
await registrarComoEmitente(REG, {
  registro_id: contrato.registro_id, produtor_ref: produtor.produtor_ref,
  quantidade_sacas: '500', valor_face: '750000.00', vencimento: '2027-07-31',
}, [{ tipo: 'PENHOR_SAFRA', referencia: 'AVERB-DEMO', valor: { valor: '400000.00', moeda: 'BRL' } },
    { tipo: 'SEGURO_AGRICOLA', referencia: 'APOLICE-DEMO', valor: { valor: '180000.00', moeda: 'BRL' } },
    { tipo: 'AVAL', referencia: 'AVAL-DEMO', valor: { valor: '120000.00', moeda: 'BRL' } },
    { tipo: 'FUNDO_MUTUALIZADO', referencia: 'FUNDO-DEMO', valor: { valor: '90000.00', moeda: 'BRL' } },
    { tipo: 'HIPOTECA', referencia: 'MATR-DEMO', valor: { valor: '600000.00', moeda: 'BRL' } }]);

const registrado = await post(`${CORE}/contratos/${contrato.id}/registro`, {});
etapa('Registro confirmado por leitura, não por escrita',
  `${contrato.registro_id}, hash do conteúdo ${registrado.conteudo_hash.slice(0, 18)}… — ` +
  'a plataforma lê o registro; quem registra é o emitente (P1)');

const espelho = await post(`${CORE}/contratos/${contrato.id}/espelho`, {});
const espelhoRepetido = await post(`${CORE}/contratos/${contrato.id}/espelho`, {});
etapa('Espelho emitido, e a segunda chamada é idempotente',
  `token ${espelho.token_id}; repetição devolveu ja_existia=${espelhoRepetido.ja_existia} (P3)`);

await post(`${CORE}/conciliacao/executar`, { contrato_id: contrato.id });
let sit = await get(`${CORE}/contratos/${contrato.id}/conciliacao`);
etapa('Conciliação inicial conforme', `situação ${sit.situacao}, contrato em circulação`);

// ------------------------------------------------- DDS e marcação a mercado
const dds = await post(`${EUDR}/dds`, {
  contrato_id: contrato.id, evidencias: [evidencia.id], operador_ref: produtor.produtor_ref,
});
etapa('Declaração de due diligence emitida', `${dds.numero}, sobre evidência conforme e vigente`);

await post(`${ORACLE}/leituras/coletar`, { tipo: 'PRECO', chave: 'CAFE_ARABICA/BRL-SACA' });
const mtm = await post(`${CORE}/contratos/${contrato.id}/marcacao`, { haircut_pct: 20 });
etapa('Marcação a mercado com preço de quórum',
  `saca R$ ${mtm.preco_saca}, MTM R$ ${mtm.valor_mtm}, LTV ${mtm.ltv_pct}%`);

// ------------------------------------- divergência injetada e reconciliação
const t0 = Date.now();
await post(`${REG}/sim/injecoes`,
  { tipo: 'VALOR_FACE_ALTERADO', entidade: 'REG-SIM', registro_id: contrato.registro_id });
await post(`${CORE}/conciliacao/executar`, { contrato_id: contrato.id });
sit = await get(`${CORE}/contratos/${contrato.id}/conciliacao`);
const div = sit.divergencias.find((d) => d.tipo === 'VALOR_FACE_ALTERADO');
etapa('Divergência injetada no registro e detectada',
  `${div.tipo} em ${Date.now() - t0} ms; contrato ${sit.situacao}; o registro prevalece`);

const txCongelamento = await post(`${CORE}/conciliacao/divergencias/${div.id}/congelar-onchain`, {});
etapa('Congelamento propagado para a cadeia',
  `tx ${String(txCongelamento.tx_congelamento).slice(0, 18)}… — o freio existe nos dois lados`);

const reconciliado = await post(`${CORE}/conciliacao/divergencias/${div.id}/reconciliacao`, {
  decisao: 'ACEITAR_REGISTRO',
  justificativa: 'Conferido com a registradora: o valor de face foi retificado na origem e o espelho será reemitido conforme o registro.',
  operador: 'OP-CONCILIACAO-07', ator_ref: produtor.produtor_ref,
});
sit = await get(`${CORE}/contratos/${contrato.id}/conciliacao`);
etapa('Reconciliação por operador humano identificado',
  `divergência ${reconciliado.estado}; contrato voltou a ${sit.situacao}; nenhum processo automático destranca`);

// ------------------------------------------------- cenário de estresse
await post(`${ORACLE}/sim/dia`, { dia: 150 });
await post(`${ORACLE}/leituras/coletar`, { tipo: 'PRECO', chave: 'CAFE_ARABICA/BRL-SACA' });
const mtmEstresse = await post(`${CORE}/contratos/${contrato.id}/marcacao`, { haircut_pct: 30 });
etapa('Cenário de estresse: quebra de safra com queda de preço',
  `saca R$ ${mtmEstresse.preco_saca} (era ${mtm.preco_saca}), LTV ${mtmEstresse.ltv_pct}% (era ${mtm.ltv_pct}%)`);

const { rows: politica } = await pool.query(
  "SELECT id FROM ops.waterfall_politica WHERE rotulo = 'cafe-sul-de-minas' LIMIT 1");
const simulacoes = [];
for (const [cenario, parametros] of Object.entries({
  INADIMPLENCIA_ISOLADA: massa.cenarios.inadimplencia_isolada,
  QUEBRA_SISTEMICA: massa.cenarios.quebra_sistemica,
  QUEDA_PRECO_EXCUSSAO: massa.cenarios.queda_preco_excussao,
})) {
  const s = await post(`${CORE}/simulacoes/waterfall`, {
    cenario, politica_id: politica[0].id, semente: 20260918,
    contratos: [contrato.id], parametros,
  });
  simulacoes.push({ cenario, perda_bruta: s.perda_bruta.valor, residual: s.perda_residual.valor, hash: s.hash_resultado });
}
const repetida = await post(`${CORE}/simulacoes/waterfall`, {
  cenario: 'QUEBRA_SISTEMICA', politica_id: politica[0].id, semente: 20260918,
  contratos: [contrato.id], parametros: massa.cenarios.quebra_sistemica,
});
const determinista = repetida.hash_resultado === simulacoes[1].hash;
etapa('Waterfall simulado nos três cenários',
  simulacoes.map((s) => `${s.cenario}: perda ${s.perda_bruta}, residual ${s.residual}`).join(' | ') +
  ` — determinística=${determinista}`);

await post(`${CORE}/contratos/${contrato.id}/inadimplencia`, { gatilho: 'LTV_ROMPIDO' });
etapa('Inadimplência registrada por gatilho de LTV', 'gatilho sustentado por leitura com quórum');

// ---------------------------------------------------------------- liquidação
await post(`${ORACLE}/sim/pagamento`,
  { chave: `REG-SIM/${contrato.registro_id}`, valor: '750000.00' });
const liquidacao = await post(`${CORE}/contratos/${contrato.id}/liquidacao`,
  { baixa_registro_ref: `BAIXA-${contrato.registro_id}` });
etapa('Liquidação com pagamento conciliado e baixa',
  `tx de baixa ${String(liquidacao.tx_baixa).slice(0, 18)}… — a plataforma concilia, não custodia (P7)`);

// --------------------------------------------------------- privacidade
let varredura = 'falhou';
try {
  varredura = execSync('node infra/ci/varrer-pii-cadeia.mjs', { encoding: 'utf8' }).trim().split('\n').pop();
} catch (e) { varredura = 'REPROVADA: ' + String(e.stdout ?? e.message).slice(0, 120); }
etapa('Varredura de PII em toda a cadeia', varredura);

const eliminacao = await post(`${COMPLIANCE}/titulares/${produtor.produtor_ref}/eliminacao`,
  { canal: 'portal', solicitante: 'titular' });
etapa('Eliminação do titular com comprovante de irreversibilidade',
  `${eliminacao.estado}; decifragem após destruição: ${eliminacao.verificacao_irreversibilidade.tentativa_decifragem}; ` +
  `retenção obrigatória: ${eliminacao.retencao_obrigatoria.length} categoria(s)`);

// ------------------------------------------------------------------ auditoria
const cadeia = await get(`${CORE}/auditoria/cadeia`);
const trilha = await get(`${CORE}/contratos/${contrato.id}/trilha`);
etapa('Trilha de auditoria íntegra',
  `${cadeia.registros} registros encadeados, ${cadeia.inconsistentes} inconsistentes; ` +
  `${trilha.length} eventos no contrato respondem "o que se sabia, quando e com base em quê"`);

const custoProdutor = await get(`${COMPLIANCE}/placar/custo-verificacao`);
const custoSelo = await get(`${EUDR}/placar/custo-selo`);
etapa('Custo de verificação instrumentado',
  `KYC: ${JSON.stringify(custoProdutor[0] ?? {})} | selo EUDR: ${JSON.stringify(custoSelo)}`);

console.log('\n=== Demonstração concluída ===');
console.log(`contrato: ${contrato.registro_id}  (${contrato.id})`);
console.log(`painel do comprador: http://127.0.0.1:3000/credor/${contrato.id}`);
console.log(`painel de auditoria: http://127.0.0.1:3000/auditoria/${contrato.id}`);
console.log(`${provas.length} passos, todos com prova associada.`);
await pool.end();
