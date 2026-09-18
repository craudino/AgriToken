// Ramos que sobraram. Ramo não coberto é ramo que ninguém leu executando —
// e é onde o defeito de segurança costuma estar.
const assert = require('node:assert/strict');
const { ethers } = require('hardhat');
const { montar, PAPEL, ANCORA } = require('./apoio.cjs');

describe('W1 — ramos restantes', function () {
  this.timeout(60_000);
  let c;
  const H = (s) => ethers.sha256(ethers.toUtf8Bytes(s));
  beforeEach(async () => { c = await montar(); });

  it('operação sobre token inexistente falha com causa clara', async () => {
    // O valor zero do enum é ATIVO: sem guarda, um id inventado pareceria ativo.
    await assert.rejects(c.espelho.connect(c.espelhador).baixar(99n, H('c')),
      (e) => /token inexistente/.test(e.message));
    await assert.rejects(c.espelho.connect(c.conciliador).congelar(99n, ethers.ZeroHash, 4),
      (e) => /token inexistente/.test(e.message));
  });

  it('garantia liberada e garantia de outro nível não entram na absorção', async () => {
    await c.espelho.connect(c.espelhador)
      .emitirEspelho(ANCORA('REG-SIM', 'CPR-1'), c.credorA.address, 1n, 1_000_000n, ethers.ZeroHash);
    const politica = H('pol');
    await c.cofre.connect(c.compliance).configurarPolitica(politica,
      Array.from({ length: 5 }, (_, i) => ({
        nivel: i + 1, rotuloHash: ethers.ZeroHash, capBps: 10000, haircutBps: 0, prazoRecuperacaoDias: 30,
      })));
    await c.cofre.connect(c.compliance).vincularPolitica(1n, politica);
    await c.cofre.connect(c.compliance).vincularGarantia(1n, H('n1a'), 1, 100_000n);
    await c.cofre.connect(c.compliance).vincularGarantia(1n, H('n1b'), 1, 50_000n);
    await c.cofre.connect(c.compliance).vincularGarantia(1n, H('n2'), 2, 70_000n);
    await c.cofre.connect(c.compliance).liberarGarantia(H('n1b'), H('m'));

    const r = await c.cofre.percorrerWaterfall(1n, 500_000n);
    assert.equal(r.absorcoes[0].absorvido, 100_000n, 'a liberada não pode absorver');
    assert.equal(r.absorcoes[1].absorvido, 70_000n);
    assert.equal(r.perdaResidual, 330_000n);
  });

  it('absorção parcial não marca o nível como esgotado', async () => {
    await c.espelho.connect(c.espelhador)
      .emitirEspelho(ANCORA('REG-SIM', 'CPR-2'), c.credorA.address, 1n, 1_000_000n, ethers.ZeroHash);
    const politica = H('pol2');
    await c.cofre.connect(c.compliance).configurarPolitica(politica,
      Array.from({ length: 5 }, (_, i) => ({
        nivel: i + 1, rotuloHash: ethers.ZeroHash, capBps: 10000, haircutBps: 0, prazoRecuperacaoDias: 30,
      })));
    await c.cofre.connect(c.compliance).vincularPolitica(1n, politica);
    await c.cofre.connect(c.compliance).vincularGarantia(1n, H('g'), 1, 500_000n);
    const r = await c.cofre.percorrerWaterfall(1n, 200_000n);
    assert.equal(r.absorcoes[0].absorvido, 200_000n);
    assert.equal(r.absorcoes[0].esgotado, false);
    assert.equal(r.perdaResidual, 0n);
  });

  it('participante nunca habilitado e participante de habilitação encerrada', async () => {
    assert.equal(await c.participantes.estaHabilitado(c.estranho.address), false);
    await c.participantes.connect(c.compliance).desabilitar(c.credorB.address, H('m'));
    assert.equal(await c.participantes.estaHabilitado(c.credorB.address), false);
    assert.equal(await c.participantes.estaHabilitado(c.credorA.address), true);
  });

  it('todos os papéis classificados quanto a sensibilidade', async () => {
    const sensiveis = ['PAPEL_ADMIN', 'PAPEL_ESPELHADOR', 'PAPEL_RECONCILIADOR_HUMANO', 'PAPEL_PAUSA'];
    const comuns = ['PAPEL_ORIGINADOR', 'PAPEL_CONCILIADOR', 'PAPEL_ORACULO'];
    for (const p of sensiveis) assert.equal(await c.acesso.papelSensivel(PAPEL(p)), true, p);
    for (const p of comuns) assert.equal(await c.acesso.papelSensivel(PAPEL(p)), false, p);
    assert.equal(await c.acesso.temPapel(PAPEL('PAPEL_ADMIN'), c.estranho.address), false);
  });

  it('transferência entre tokens exige titular do destino habilitado', async () => {
    await c.espelho.connect(c.espelhador)
      .emitirEspelho(ANCORA('REG-SIM', 'A'), c.credorA.address, 1n, 1000n, ethers.ZeroHash);
    await c.espelho.connect(c.espelhador)
      .emitirEspelho(ANCORA('REG-SIM', 'B'), c.credorB.address, 1n, 1000n, ethers.ZeroHash);
    await c.participantes.connect(c.compliance).desabilitar(c.credorB.address, H('m'));
    await assert.rejects(
      c.espelho.connect(c.credorA)['transferFrom(uint256,uint256,uint256)'](1n, 2n, 10n),
      (e) => /ParticipanteNaoHabilitado/.test(e.message));
  });
});

describe('W1 — âncora isolada', function () {
  // A âncora é contrato imutável e independente (ADR-0004). Testá-la em
  // isolamento alcança os ramos defensivos que o espelho, por construção
  // correta, nunca consegue disparar.
  const assert = require('node:assert/strict');
  const { ethers } = require('hardhat');
  const H = (s) => ethers.sha256(ethers.toUtf8Bytes(s));

  it('recusa baixa de âncora desconhecida e vincula uma única vez', async () => {
    const [operador, outro] = await ethers.getSigners();
    const ancora = await (await ethers.getContractFactory('AncoraRegistro')).deploy(operador.address);

    await assert.rejects(ancora.baixar(H('nunca-vinculada'), H('c')),
      (e) => /AncoraDesconhecida/.test(e.message));

    await ancora.vincular(H('a1'), 7n);
    assert.equal(await ancora.tokenDaAncora(H('a1')), 7n);
    assert.equal(await ancora.ancoraDoToken(7n), H('a1'));
    assert.equal(await ancora.totalAncoras(), 1n);
    assert.equal(await ancora.ancoraBaixada(H('a1')), false);

    await assert.rejects(ancora.vincular(H('a1'), 8n), (e) => /AncoraJaUtilizada/.test(e.message));
    await assert.rejects(ancora.connect(outro).vincular(H('a2'), 9n),
      (e) => /somente o espelho/.test(e.message));

    await ancora.baixar(H('a1'), H('comprovante'));
    assert.equal(await ancora.ancoraBaixada(H('a1')), true);
    assert.equal(await ancora.ancoraDisponivel(H('a1')), false,
      'baixar não devolve a âncora ao pool — reabriria a porta de P3');
  });
});
