// Invariantes de W1 (docs/contracts/abi/README.md). Não são sugestões de teste:
// são a definição de pronto do workstream. Cada um corresponde a um princípio
// que, se falhar, derruba a tese do MVP.
const assert = require('node:assert/strict');
const { ethers } = require('hardhat');
const { montar, avancar, PAPEL, ANCORA } = require('./apoio.cjs');

describe('W1 — invariantes do espelho', function () {
  this.timeout(120_000);
  let c;
  beforeEach(async () => { c = await montar(); });

  const emitir = async (registroId, valor = 1000n, titular) =>
    c.espelho.connect(c.espelhador).emitirEspelho(
      ANCORA('REG-SIM', registroId), (titular ?? c.credorA).address, 1n, valor,
      ethers.sha256(ethers.toUtf8Bytes(`doc-${registroId}`)));

  it('I1 — nunca existem dois tokens ativos para a mesma âncora (P3)', async () => {
    await emitir('CPR-1');
    await assert.rejects(
      emitir('CPR-1'),
      (e) => /AncoraJaUtilizada/.test(e.message),
      'a segunda emissão para o mesmo registro precisa reverter',
    );
    assert.equal(await c.espelho.totalAncoras(), 1n);
  });

  it('I1b — âncoras distintas convivem, e a baixa não libera a âncora', async () => {
    await emitir('CPR-1');
    await emitir('CPR-2');
    assert.equal(await c.espelho.totalAncoras(), 2n);
    await c.espelho.connect(c.espelhador).baixar(1n, ethers.sha256(ethers.toUtf8Bytes('baixa')));
    await assert.rejects(emitir('CPR-1'), (e) => /AncoraJaUtilizada/.test(e.message),
      'título baixado não volta a ser espelhável');
  });

  it('I2 — a soma das frações nunca excede o total emitido (P3)', async () => {
    await emitir('CPR-1', 1000n);
    // Sequência pseudoaleatória de fracionamentos, determinística por semente.
    let semente = 42n;
    const proximo = () => { semente = (semente * 6364136223846793005n + 1442695040888963407n) % (2n ** 64n); return semente; };
    const tokens = [1n];
    for (let i = 0; i < 25; i++) {
      const origem = tokens[Number(proximo() % BigInt(tokens.length))];
      const saldo = await c.espelho.balanceOf(origem);
      if (saldo === 0n) continue;
      const valor = (proximo() % saldo) + 1n;
      const destino = (proximo() % 2n) === 0n ? c.credorA : c.credorB;
      const dono = await c.espelho.proprietarioDe(origem);
      const signer = dono === c.credorA.address ? c.credorA : c.credorB;
      const tx = await c.espelho.connect(signer)['transferFrom(uint256,address,uint256)'](origem, destino.address, valor);
      const r = await tx.wait();
      const ev = r.logs.map((l) => { try { return c.espelho.interface.parseLog(l); } catch { return null; } })
        .find((p) => p && p.name === 'TitularidadeAlterada');
      tokens.push(ev.args.novoTokenId);

      const emitido = await c.espelho.valorEmitidoDoSlot(1n);
      let soma = 0n;
      for (const t of tokens) soma += await c.espelho.balanceOf(t);
      assert.ok(soma <= emitido, `soma ${soma} excedeu o emitido ${emitido} na iteração ${i}`);
    }
  });

  it('I3 — token congelado não transfere valor por nenhum caminho (P1)', async () => {
    await emitir('CPR-1', 1000n);
    await c.espelho.connect(c.conciliador)
      .congelar(1n, ethers.sha256(ethers.toUtf8Bytes('divergencia')), 4);

    await assert.rejects(
      c.espelho.connect(c.credorA)['transferFrom(uint256,address,uint256)'](1n, c.credorB.address, 10n),
      (e) => /EspelhoCongeladoErro/.test(e.message), 'fracionamento em token congelado');

    await assert.rejects(
      c.espelho.connect(c.credorA).approve(1n, c.credorB.address, 10n),
      (e) => /EspelhoCongeladoErro/.test(e.message), 'aprovação em token congelado');
  });

  it('I4 — só o papel humano de reconciliação descongela (P1)', async () => {
    await emitir('CPR-1');
    await c.espelho.connect(c.conciliador).congelar(1n, ethers.ZeroHash, 4);
    const rec = ethers.sha256(ethers.toUtf8Bytes('reconciliacao'));

    for (const quem of [c.conciliador, c.espelhador, c.admin, c.credorA]) {
      await assert.rejects(c.espelho.connect(quem).descongelar(1n, rec),
        (e) => /SemPapel/.test(e.message), `${quem.address} não deveria descongelar`);
    }
    await c.espelho.connect(c.reconciliador).descongelar(1n, rec);
    assert.equal(await c.espelho.estaCongelado(1n), false);
  });

  it('I5 — atualizar hash documental não move valor nem titular (P1)', async () => {
    await emitir('CPR-1', 1000n);
    const antes = { saldo: await c.espelho.balanceOf(1n), dono: await c.espelho.proprietarioDe(1n) };
    await c.espelho.connect(c.espelhador)
      .atualizarHashDocumental(1n, ethers.sha256(ethers.toUtf8Bytes('novo')), ethers.ZeroHash);
    assert.equal(await c.espelho.balanceOf(1n), antes.saldo);
    assert.equal(await c.espelho.proprietarioDe(1n), antes.dono);
  });

  it('I6 — msg.value diferente de zero reverte (P7)', async () => {
    await emitir('CPR-1', 1000n);
    await assert.rejects(
      c.espelho.connect(c.credorA).approve(1n, c.credorB.address, 10n, { value: 1n }),
      (e) => /ValorNaoAceito/.test(e.message),
      'ether enviado em rede sem moeda nativa seria valor preso para sempre');
  });

  it('I7 — nenhum evento carrega tipo capaz de transportar PII (P2)', async () => {
    const permitidos = new Set(['bytes32', 'address', 'uint256', 'uint8', 'bool', 'uint64']);
    for (const frag of c.espelho.interface.fragments.filter((f) => f.type === 'event')) {
      for (const input of frag.inputs) {
        assert.ok(permitidos.has(input.type),
          `evento ${frag.name} tem parâmetro ${input.name} do tipo ${input.type}, que aceita texto livre`);
      }
    }
  });

  it('I8 — percorrerWaterfall é determinística e sem efeito (P6)', async () => {
    await emitir('CPR-1', 1_000_000n);
    const politica = ethers.sha256(ethers.toUtf8Bytes('cafe-sul-de-minas-v1'));
    const niveis = [
      { nivel: 1, rotuloHash: ethers.ZeroHash, capBps: 6000, haircutBps: 2500, prazoRecuperacaoDias: 45 },
      { nivel: 2, rotuloHash: ethers.ZeroHash, capBps: 2500, haircutBps: 1000, prazoRecuperacaoDias: 90 },
      { nivel: 3, rotuloHash: ethers.ZeroHash, capBps: 2000, haircutBps: 4000, prazoRecuperacaoDias: 180 },
      { nivel: 4, rotuloHash: ethers.ZeroHash, capBps: 1500, haircutBps: 0, prazoRecuperacaoDias: 30 },
      { nivel: 5, rotuloHash: ethers.ZeroHash, capBps: 10000, haircutBps: 3500, prazoRecuperacaoDias: 540 },
    ];
    await c.cofre.connect(c.compliance).configurarPolitica(politica, niveis);
    await c.cofre.connect(c.compliance).vincularPolitica(1n, politica);
    await c.cofre.connect(c.compliance)
      .vincularGarantia(1n, ethers.sha256(ethers.toUtf8Bytes('penhor')), 1, 400_000n);

    const a = await c.cofre.percorrerWaterfall(1n, 500_000n);
    await avancar(3600);
    const b = await c.cofre.percorrerWaterfall(1n, 500_000n);
    assert.equal(JSON.stringify(a, (_, v) => typeof v === 'bigint' ? v.toString() : v),
                 JSON.stringify(b, (_, v) => typeof v === 'bigint' ? v.toString() : v),
                 'mesma entrada precisa devolver o mesmo resultado em blocos distintos');
    // Deságio de 25% sobre 400.000 = 300.000 absorvidos no nível 1.
    assert.equal(a.absorcoes[0].absorvido, 300_000n);
  });

  it('I9 — espelho não circula para quem não está habilitado (ADR-0005)', async () => {
    await emitir('CPR-1', 1000n);
    await assert.rejects(
      c.espelho.connect(c.credorA)['transferFrom(uint256,address,uint256)'](1n, c.estranho.address, 10n),
      (e) => /TitularNaoHabilitado/.test(e.message), 'destino nunca habilitado');

    await c.participantes.connect(c.compliance)
      .desabilitar(c.credorB.address, ethers.sha256(ethers.toUtf8Bytes('embargo')));
    await assert.rejects(
      c.espelho.connect(c.credorA)['transferFrom(uint256,address,uint256)'](1n, c.credorB.address, 10n),
      (e) => /TitularNaoHabilitado/.test(e.message), 'destino desabilitado depois de habilitado');
  });

  it('I9b — habilitação vencida não habilita', async () => {
    await emitir('CPR-1', 1000n);
    const curta = (await ethers.provider.getBlock('latest')).timestamp + 120;
    await c.participantes.connect(c.compliance)
      .habilitar(c.credorB.address, ethers.ZeroHash, curta);
    await avancar(300);
    await assert.rejects(
      c.espelho.connect(c.credorA)['transferFrom(uint256,address,uint256)'](1n, c.credorB.address, 10n),
      (e) => /TitularNaoHabilitado/.test(e.message));
  });
});
