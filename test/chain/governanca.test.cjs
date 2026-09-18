// Governança: timelock, pausa e fronteira. Os três pontos que o red team
// atacou em G1 e que o ADR-0004 e o ADR-0007 comprometem-se a sustentar.
const assert = require('node:assert/strict');
const { ethers } = require('hardhat');
const { montar, avancar, PAPEL, ANCORA, ATRASO } = require('./apoio.cjs');

describe('W1 — governança e fronteira', function () {
  this.timeout(120_000);
  let c;
  beforeEach(async () => { c = await montar(); });

  it('papel sensível não é concedido por chamada única (SMC-005)', async () => {
    await assert.rejects(
      c.acesso.conceder(PAPEL('PAPEL_ESPELHADOR'), c.estranho.address),
      (e) => /PapelExigeTimelock/.test(e.message),
      'antes de SMC-005 o timelock existia só no NatSpec');
  });

  it('proposta não executa antes do prazo, e executa depois', async () => {
    await c.acesso.propor(PAPEL('PAPEL_PAUSA'), c.estranho.address);
    await assert.rejects(
      c.acesso.executarProposta(PAPEL('PAPEL_PAUSA'), c.estranho.address),
      (e) => /TimelockPendente/.test(e.message));
    await avancar(ATRASO + 1);
    await c.acesso.executarProposta(PAPEL('PAPEL_PAUSA'), c.estranho.address);
    assert.equal(await c.acesso.temPapel(PAPEL('PAPEL_PAUSA'), c.estranho.address), true);
  });

  it('revogação é imediata — atrasar protegeria o atacante', async () => {
    await c.acesso.revogar(PAPEL('PAPEL_CONCILIADOR'), c.conciliador.address);
    await assert.rejects(
      c.espelho.connect(c.conciliador).congelar(1n, ethers.ZeroHash, 4),
      (e) => /SemPapel/.test(e.message));
  });

  it('atualização de implementação respeita o timelock (ADR-0004)', async () => {
    const nova = await (await ethers.getContractFactory('EspelhoCPR')).deploy();
    await c.espelho.proporAtualizacao(await nova.getAddress());
    await assert.rejects(c.espelho.executarAtualizacao(await nova.getAddress()),
      (e) => /timelock pendente/.test(e.message));
    await avancar(ATRASO + 1);
    await c.espelho.executarAtualizacao(await nova.getAddress());
    assert.equal(await c.espelho.implementacao(), await nova.getAddress());
  });

  it('pausa suspende circulação e NÃO descongela (ADR-0007)', async () => {
    await c.espelho.connect(c.espelhador).emitirEspelho(
      ANCORA('REG-SIM', 'CPR-1'), c.credorA.address, 1n, 1000n, ethers.ZeroHash);
    await c.espelho.connect(c.conciliador).congelar(1n, ethers.ZeroHash, 4);

    await c.espelho.connect(c.admin).pausar(true);
    await assert.rejects(
      c.espelho.connect(c.credorA)['transferFrom(uint256,address,uint256)'](1n, c.credorB.address, 1n),
      (e) => /Pausa/.test(e.message));

    await c.espelho.connect(c.admin).pausar(false);
    assert.equal(await c.espelho.estaCongelado(1n), true,
      'pausa não pode ser um descongelamento com outro nome');
  });

  it('P7 — o cofre não tem função payable, receive nem fallback', async () => {
    const abi = require('../../artifacts/out/contracts/src/CofreGarantias.sol/CofreGarantias.json').abi;
    assert.equal(abi.filter((i) => i.stateMutability === 'payable').length, 0);
    assert.equal(abi.filter((i) => i.type === 'receive' || i.type === 'fallback').length, 0);
  });

  it('P7 — nenhum contrato aceita ether', async () => {
    for (const nome of ['EspelhoCPR', 'CofreGarantias', 'AncoraRegistro', 'ControleAcesso', 'RegistroParticipantes']) {
      const endereco = await c[nome[0].toLowerCase() + nome.slice(1)]?.getAddress?.()
        ?? await c.espelho.getAddress();
      await assert.rejects(
        c.admin.sendTransaction({ to: endereco, value: 1n }),
        `${nome} aceitou ether — em rede sem moeda nativa, valor preso`);
    }
  });

  it('congelado não recebe garantia nova (P1)', async () => {
    await c.espelho.connect(c.espelhador).emitirEspelho(
      ANCORA('REG-SIM', 'CPR-1'), c.credorA.address, 1n, 1000n, ethers.ZeroHash);
    await c.espelho.connect(c.conciliador).congelar(1n, ethers.ZeroHash, 4);
    await assert.rejects(
      c.cofre.connect(c.compliance).vincularGarantia(1n, ethers.ZeroHash, 1, 100n),
      (e) => /EspelhoCongelado/.test(e.message));
  });

  it('política de waterfall é imutável depois de registrada (P6)', async () => {
    const politica = ethers.sha256(ethers.toUtf8Bytes('p1'));
    const niveis = Array.from({ length: 5 }, (_, i) => ({
      nivel: i + 1, rotuloHash: ethers.ZeroHash, capBps: 1000, haircutBps: 0, prazoRecuperacaoDias: 30,
    }));
    await c.cofre.connect(c.compliance).configurarPolitica(politica, niveis);
    await assert.rejects(
      c.cofre.connect(c.compliance).configurarPolitica(politica, niveis),
      (e) => /politica imutavel/.test(e.message),
      'recalibrar cria nova versão, para que simulação antiga siga reproduzível');
  });
});
