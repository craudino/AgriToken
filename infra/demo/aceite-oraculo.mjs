#!/usr/bin/env node
// Aceite de degradação de oráculo sob falha injetada (critério de G2).
//
// Degradação graciosa que nunca foi exercitada sob falha não é degradação
// graciosa, é esperança. Este roteiro derruba fontes de propósito e afirma o
// que o sistema faz em cada configuração — inclusive, e principalmente, quando
// o que sobra PARECE quórum e não é.
//
// O caso decisivo é o C3. As fontes de preço são quatro, mas AGREGADOR_X
// declara `independente_de = {CEPEA}`: republica o mesmo boletim. Derrubando
// B3_FUT e COOP_SUL sobram duas fontes ATIVAS e UMA fonte independente. Um
// sistema que contasse fontes brutas diria "quórum de 2 atingido" e seguiria
// decidindo contrato com uma única origem de informação — mais confiante do
// que estaria com uma fonte declarada. É a redundância aparente do ADR-0003,
// e é pior que ausência de redundância porque induz confiança injustificada.
import { get, post } from './cliente.mjs';

const ORACLE = process.env.URL_ORACLE ?? 'http://127.0.0.1:3002';
const REGISTRADORA = process.env.URL_REGISTRADORA ?? 'http://127.0.0.1:3005';
const CHAVE_PRECO = 'CAFE_ARABICA';

const casos = [];
const registrar = (nome, esperado, obtido, nota = '') => {
  const ok = JSON.stringify(esperado) === JSON.stringify(obtido);
  casos.push({ nome, esperado, obtido, ok, nota });
  return ok;
};

const derrubar = (f) => post(`${ORACLE}/sim/fonte/${f}/derrubar`);
const levantar = (f) => post(`${ORACLE}/sim/fonte/${f}/levantar`);
const coletar = (tipo, chave, url) => post(`${ORACLE}/leituras/coletar`, { tipo, chave, url });
const degradacao = () => get(`${ORACLE}/saude/degradacao`);
const panorama = async (tipo) => (await degradacao()).find((d) => d.tipo === tipo);

const TODAS_PRECO = ['CEPEA', 'AGREGADOR_X', 'B3_FUT', 'COOP_SUL'];
const restaurar = async () => { for (const f of TODAS_PRECO.concat(['BANCO_A', 'SPI', 'REG_SIM_1', 'REG_SIM_2'])) await levantar(f); };

await restaurar();

// ---------------------------------------------------------------- C1: normal
const c1 = await coletar('PRECO', CHAVE_PRECO);
registrar('C1 estado normal: 4 fontes, 3 independentes', 'EFETIVA', c1.estado,
  `fontes=${c1.fontesUsadas} independentes=${c1.fontesIndependentes}`);
registrar('C1 contagem de independentes desconta a fonte correlacionada', 3, c1.fontesIndependentes);

// ------------------------------------------- C2: perda que o quórum absorve
await derrubar('COOP_SUL');
const c2 = await coletar('PRECO', CHAVE_PRECO);
registrar('C2 uma fonte caída: ainda há quórum', true,
  ['EFETIVA', 'DEGRADADA'].includes(c2.estado), `estado=${c2.estado} independentes=${c2.fontesIndependentes}`);
registrar('C2 a fonte caída aparece como descartada na linhagem', true,
  (await get(`${ORACLE}/leituras/${c2.id}/linhagem`)).descartadas.some((d) => d.fonte === 'COOP_SUL'));

// --------------------------------- C3: redundância APARENTE — o caso decisivo
await derrubar('B3_FUT');
const c3 = await coletar('PRECO', CHAVE_PRECO);
registrar('C3 sobram 2 fontes ativas', 2, c3.fontesUsadas);
registrar('C3 mas só 1 independente: CEPEA e o agregador que o republica', 1, c3.fontesIndependentes);
registrar('C3 redundância aparente NÃO produz leitura efetiva', 'SEM_QUORUM', c3.estado,
  'contar fontes brutas aqui daria quórum de 2 com uma origem só');

// ----------------------------- C4: a perda não é simétrica entre as fontes
await levantar('B3_FUT'); await levantar('COOP_SUL');
await derrubar('AGREGADOR_X');
const c4 = await coletar('PRECO', CHAVE_PRECO);
registrar('C4 derrubar o agregador custa menos que derrubar a fonte primária', 'EFETIVA', c4.estado,
  `3 fontes, ${c4.fontesIndependentes} independentes`);

// -------------- C5: leitura vigente durante falha corrente precisa avisar
await levantar('AGREGADOR_X');
await coletar('PRECO', CHAVE_PRECO);            // grava leitura com quórum na janela
await derrubar('B3_FUT'); await derrubar('COOP_SUL');
await coletar('PRECO', CHAVE_PRECO);            // coleta corrente perde o quórum
const vigente = await get(`${ORACLE}/leituras/efetiva?tipo=PRECO&chave=${CHAVE_PRECO}`);
registrar('C5 leitura na janela continua servida', true, vigente.valor_numerico != null);
registrar('C5 e vem marcada com a falha CORRENTE, não a do momento da coleta',
  true, vigente.coleta_corrente_sem_quorum === true);
registrar('C5 com aviso explícito para quem consome', true,
  typeof vigente.aviso === 'string' && vigente.aviso.length > 0, vigente.aviso ?? '(sem aviso)');

// -------------------- C6: painel de saúde reporta independentes, não brutas
const pPreco = await panorama('PRECO');
registrar('C6 painel conta 2 fontes ativas', 2, pPreco.fontes_ativas);
registrar('C6 e 1 independente — o número que decide', 1, pPreco.fontes_independentes_ativas);
registrar('C6 painel declara sem_quorum', true, pPreco.sem_quorum);

await restaurar();

// ------------------- C7: UNANIMIDADE sem degradação — pagamento e registro
//
// Cada caso exige um CONTROLE antes da falha. Sem ele, "SEM_QUORUM com uma
// fonte derrubada" não prova nada: um título inexistente derruba as duas
// fontes por 404 e o resultado é idêntico. A primeira versão deste roteiro
// tinha exatamente esse defeito — passava com `fontes=0`, ou seja, provando
// que nada funcionava em vez de provar que a fonte caiu.
const titulos = await get(`${REGISTRADORA}/titulos`);
const alvoRegistro = titulos.itens?.[0]
  ? `${titulos.itens[0].entidade}/${titulos.itens[0].registro_id}`
  : null;
if (!alvoRegistro) throw new Error('sem título registrado: rode `npm run demo` antes do aceite');

// PAGAMENTO precisa de um pagamento confirmado para que o controle tenha quórum.
const chavePagamento = 'CONTRATO/aceite-g2';
await post(`${ORACLE}/sim/pagamento`, { chave: chavePagamento, valor: '1000.00' });

// A leitura de REGISTRO recebe a URL da registradora no corpo, que é como o
// núcleo a chama. Ver C9: chamar sem ela tem comportamento próprio, e ruim.
for (const [tipo, fonteAlvo, chave, url] of [['PAGAMENTO', 'BANCO_A', chavePagamento, undefined],
                                             ['REGISTRO', 'REG_SIM_1', alvoRegistro, REGISTRADORA]]) {
  const controle = await coletar(tipo, chave, url);
  registrar(`C7 ${tipo} — CONTROLE: com as duas fontes de pé há quórum`, 'EFETIVA', controle.estado,
    `fontes=${controle.fontesUsadas}`);

  await derrubar(fonteAlvo);
  const r = await coletar(tipo, chave, url);
  registrar(`C7 ${tipo}: uma fonte caída em política sem degradação`, 'SEM_QUORUM', r.estado,
    `permite_degradado=false, fontes=${r.fontesUsadas} (era ${controle.fontesUsadas})`);
  registrar(`C7 ${tipo}: a perda é de UMA fonte, não colapso das duas`, 1, r.fontesUsadas,
    'distingue "fonte caiu" de "nada funciona"');
  await levantar(fonteAlvo);
}

// -------- C9: o recuo silencioso de URL_REGISTRADORA (achado G2-A3-01)
//
// `lerRegistro` recua para `process.env.URL_REGISTRADORA ?? ''` quando o corpo
// não traz a URL. O orquestrador de desenvolvimento não define essa variável no
// processo do oráculo; o compose define. Resultado: a MESMA chamada tem
// comportamento diferente em dois ambientes, e no de desenvolvimento as duas
// fontes falham por URL malformada.
//
// O sistema recusa em vez de inventar — falha fechada, e a linhagem grava o
// motivo real. Mas o caso está aqui porque divergência de ambiente descoberta
// em produção é descoberta tarde, e porque este roteiro só a encontrou depois
// de ganhar um caso de CONTROLE. A primeira versão passava com `fontes=0`:
// provava que nada funcionava, não que a fonte havia caído.
const semUrl = await coletar('REGISTRO', alvoRegistro, undefined);
registrar('C9 leitura de REGISTRO sem url no corpo recusa (não inventa)', 'SEM_QUORUM', semUrl.estado,
  `fontes=${semUrl.fontesUsadas} — recuo para env ausente neste ambiente`);
const linhagemSemUrl = await get(`${ORACLE}/leituras/${semUrl.id}/linhagem`);
registrar('C9 e a linhagem grava a causa verdadeira, não "fonte caiu"', true,
  linhagemSemUrl.descartadas.every((d) => /parse URL/i.test(d.motivo_descarte ?? '')),
  linhagemSemUrl.descartadas[0]?.motivo_descarte ?? '(sem motivo)');

// ------------------------------------- C8: recuperação — voltar a funcionar
await restaurar();
const c8 = await coletar('PRECO', CHAVE_PRECO);
registrar('C8 restabelecidas as fontes, a leitura volta a ter efeito', 'EFETIVA', c8.estado);
const p8 = await panorama('PRECO');
registrar('C8 e o painel volta a declarar quórum', false, p8.sem_quorum);

// ---------------------------------------------------------------- relatório
console.log('\n=== Aceite de degradação de oráculo sob falha injetada ===\n');
console.table(casos.map((c) => ({
  caso: c.nome, esperado: JSON.stringify(c.esperado), obtido: JSON.stringify(c.obtido),
  resultado: c.ok ? 'ok' : 'FALHOU', nota: c.nota,
})));
const falhas = casos.filter((c) => !c.ok);
console.log(`\n${casos.length - falhas.length}/${casos.length} casos conformes`);
for (const f of falhas) console.error(`  FALHOU  ${f.nome}: esperado ${JSON.stringify(f.esperado)}, obtido ${JSON.stringify(f.obtido)}`);
process.exit(falhas.length ? 1 : 0);
