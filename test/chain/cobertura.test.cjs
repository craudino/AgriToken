// Caminhos que os testes de invariante não exercitam: consultas, permissões,
// ciclo de vida completo e ramos de erro. O aceite de W1 pede 90% de cobertura,
// e cobertura baixa em ramo de erro é o lugar onde bug de segurança mora.
const assert = require('node:assert/strict');
const { ethers } = require('hardhat');
const { montar, avancar, PAPEL, ANCORA, ATRASO } = require('./apoio.cjs');

describe('W1 — caminhos completos', function () {
  this.timeout(120_000);
  let c;
  const H = (s) => ethers.sha256(ethers.toUtf8Bytes(s));
  beforeEach(async () => { c = await montar(); });

  const emitir = (id, valor = 1000n, titular) =>
    c.espelho.connect(c.espelhador)
      .emitirEspelho(ANCORA('REG-SIM', id), (titular ?? c.credorA).address, 1n, valor, H(`doc-${id}`));

  describe('emissão', () => {
    it('recusa emissão por quem não tem o papel', async () => {
      await assert.rejects(
        c.espelho.connect(c.credorA).emitirEspelho(ANCORA('REG-SIM', 'X'), c.credorA.address, 1n, 1n, ethers.ZeroHash),
        (e) => /SemPapel/.test(e.message));
    });
    it('recusa titular não habilitado', async () => {
      await assert.rejects(emitir('X', 1000n, c.estranho), (e) => /TitularNaoHabilitado/.test(e.message));
    });
    it('recusa valor zero', async () => {
      await assert.rejects(emitir('X', 0n), (e) => /valor zero/.test(e.message));
    });
    it('recusa âncora nula', async () => {
      await assert.rejects(
        c.espelho.connect(c.espelhador).emitirEspelho(ethers.ZeroHash, c.credorA.address, 1n, 1n, ethers.ZeroHash),
        (e) => /AncoraNula/.test(e.message));
    });
    it('expõe âncora, slot, saldo e hash documental', async () => {
      await emitir('CPR-1', 500n);
      assert.equal(await c.espelho.ancoraDoToken(1n), ANCORA('REG-SIM', 'CPR-1'));
      assert.equal(await c.espelho.tokenDaAncora(ANCORA('REG-SIM', 'CPR-1')), 1n);
      assert.equal(await c.espelho.ancoraDisponivel(ANCORA('REG-SIM', 'CPR-2')), true);
      assert.equal(await c.espelho.slotOf(1n), 1n);
      assert.equal(await c.espelho.balanceOf(1n), 500n);
      assert.equal(await c.espelho.hashDocumentalDe(1n), H('doc-CPR-1'));
      assert.equal(await c.espelho.valueDecimals(), 4n);
      assert.equal(await c.espelho.valorEmitidoDoSlot(1n), 500n);
      assert.equal(await c.espelho.valorCirculanteDoSlot(1n), 500n);
      assert.equal(await c.espelho.pausado(), false);
    });
    it('só o próprio espelho vincula âncora', async () => {
      await assert.rejects(c.ancora.connect(c.admin).vincular(H('a'), 99n),
        (e) => /somente o espelho/.test(e.message));
    });
  });

  describe('permissões e transferência entre tokens', () => {
    it('operador aprovado transfere dentro do limite e o limite se esgota', async () => {
      await emitir('CPR-1', 1000n);
      await emitir('CPR-2', 100n, c.credorB);
      await c.espelho.connect(c.credorA).approve(1n, c.credorB.address, 300n);
      assert.equal(await c.espelho.allowance(1n, c.credorB.address), 300n);

      await c.espelho.connect(c.credorB)['transferFrom(uint256,uint256,uint256)'](1n, 2n, 200n);
      assert.equal(await c.espelho.balanceOf(1n), 800n);
      assert.equal(await c.espelho.balanceOf(2n), 300n);
      assert.equal(await c.espelho.allowance(1n, c.credorB.address), 100n);

      await assert.rejects(
        c.espelho.connect(c.credorB)['transferFrom(uint256,uint256,uint256)'](1n, 2n, 200n),
        (e) => /sem permissao suficiente/.test(e.message));
    });
    it('recusa transferência entre slots distintos', async () => {
      await emitir('CPR-1', 1000n);
      await c.espelho.connect(c.espelhador)
        .emitirEspelho(ANCORA('REG-SIM', 'CPR-9'), c.credorB.address, 2n, 100n, ethers.ZeroHash);
      await assert.rejects(
        c.espelho.connect(c.credorA)['transferFrom(uint256,uint256,uint256)'](1n, 2n, 10n),
        (e) => /slots distintos/.test(e.message));
    });
    it('recusa valor acima do saldo', async () => {
      await emitir('CPR-1', 100n);
      await assert.rejects(
        c.espelho.connect(c.credorA)['transferFrom(uint256,address,uint256)'](1n, c.credorB.address, 101n),
        (e) => /ValorExcedeTotal/.test(e.message));
    });
    it('só o titular aprova', async () => {
      await emitir('CPR-1', 100n);
      await assert.rejects(c.espelho.connect(c.credorB).approve(1n, c.credorB.address, 1n),
        (e) => /somente o titular/.test(e.message));
    });
    it('transferência entre tokens recusa destino congelado', async () => {
      await emitir('CPR-1', 1000n);
      await emitir('CPR-2', 100n, c.credorB);
      await c.espelho.connect(c.conciliador).congelar(2n, ethers.ZeroHash, 3);
      await assert.rejects(
        c.espelho.connect(c.credorA)['transferFrom(uint256,uint256,uint256)'](1n, 2n, 10n),
        (e) => /EspelhoCongeladoErro/.test(e.message));
    });
  });

  describe('ciclo de vida', () => {
    it('baixa zera o circulante do slot e marca o estado', async () => {
      await emitir('CPR-1', 1000n);
      await c.espelho.connect(c.espelhador).baixar(1n, H('comprovante'));
      assert.equal(await c.espelho.estadoDo(1n), 2n);          // BAIXADO
      assert.equal(await c.espelho.balanceOf(1n), 0n);
      assert.equal(await c.espelho.valorCirculanteDoSlot(1n), 0n);
      assert.equal(await c.espelho.valorEmitidoDoSlot(1n), 1000n, 'o emitido é histórico e não se apaga');
      assert.equal(await c.ancora.ancoraBaixada(ANCORA('REG-SIM', 'CPR-1')), true);
    });
    it('token baixado não transfere nem é baixado de novo', async () => {
      await emitir('CPR-1', 1000n);
      await c.espelho.connect(c.espelhador).baixar(1n, H('c'));
      await assert.rejects(
        c.espelho.connect(c.credorA)['transferFrom(uint256,address,uint256)'](1n, c.credorB.address, 1n),
        (e) => /EstadoInvalido/.test(e.message));
      await assert.rejects(c.espelho.connect(c.espelhador).baixar(1n, H('c')),
        (e) => /EstadoInvalido/.test(e.message));
    });
    it('executar aceita token ativo ou congelado, e nunca baixado', async () => {
      await emitir('CPR-1', 1000n);
      await emitir('CPR-2', 1000n, c.credorB);
      await c.espelho.connect(c.conciliador).congelar(2n, ethers.ZeroHash, 4);
      await c.espelho.connect(c.conciliador).executar(1n, H('decisao'));
      await c.espelho.connect(c.conciliador).executar(2n, H('decisao'));
      assert.equal(await c.espelho.estadoDo(1n), 3n);          // EXECUTADO
      await emitir('CPR-3', 10n);
      await c.espelho.connect(c.espelhador).baixar(3n, H('c'));
      await assert.rejects(c.espelho.connect(c.conciliador).executar(3n, H('d')),
        (e) => /estado nao permite/.test(e.message));
    });
    it('não congela duas vezes nem descongela o que não está congelado', async () => {
      await emitir('CPR-1', 10n);
      await c.espelho.connect(c.conciliador).congelar(1n, ethers.ZeroHash, 4);
      await assert.rejects(c.espelho.connect(c.conciliador).congelar(1n, ethers.ZeroHash, 4),
        (e) => /EstadoInvalido/.test(e.message));
      await c.espelho.connect(c.reconciliador).descongelar(1n, H('r'));
      await assert.rejects(c.espelho.connect(c.reconciliador).descongelar(1n, H('r')),
        (e) => /EstadoInvalido/.test(e.message));
    });
    it('não reinicializa', async () => {
      await assert.rejects(
        c.espelho.inicializar(await c.acesso.getAddress(), await c.participantes.getAddress(), await c.ancora.getAddress()),
        (e) => /JaInicializado/.test(e.message),
        'implementação reinicializável é sequestrável — armadilha clássica do UUPS');
    });
  });

  describe('participantes', () => {
    it('expõe atestação e validade, e recusa validade no passado', async () => {
      const t = (await ethers.provider.getBlock('latest')).timestamp;
      assert.equal(await c.participantes.atestacaoDe(c.credorA.address), H(`kyc-${c.credorA.address}`));
      assert.ok(await c.participantes.habilitacaoValidaAte(c.credorA.address) > t);
      await assert.rejects(
        c.participantes.connect(c.compliance).habilitar(c.estranho.address, ethers.ZeroHash, t - 1),
        (e) => /validade no passado/.test(e.message));
    });
    it('só o compliance habilita', async () => {
      await assert.rejects(
        c.participantes.connect(c.credorA).habilitar(c.estranho.address, ethers.ZeroHash, 4102444800),
        (e) => /SemPapel/.test(e.message));
    });
    it('exigirHabilitado reverte com o erro tipado', async () => {
      await assert.rejects(c.participantes.exigirHabilitado(c.estranho.address),
        (e) => /ParticipanteNaoHabilitado/.test(e.message));
    });
  });

  describe('controle de acesso', () => {
    it('cancela proposta pendente e recusa cancelar o que não existe', async () => {
      await c.acesso.propor(PAPEL('PAPEL_PAUSA'), c.estranho.address);
      assert.ok(await c.acesso.propostaExecutavelEm(PAPEL('PAPEL_PAUSA'), c.estranho.address) > 0n);
      await c.acesso.cancelarProposta(PAPEL('PAPEL_PAUSA'), c.estranho.address, H('motivo'));
      assert.equal(await c.acesso.propostaExecutavelEm(PAPEL('PAPEL_PAUSA'), c.estranho.address), 0n);
      await assert.rejects(c.acesso.cancelarProposta(PAPEL('PAPEL_PAUSA'), c.estranho.address, H('m')),
        (e) => /PropostaInexistente/.test(e.message));
      await assert.rejects(c.acesso.executarProposta(PAPEL('PAPEL_PAUSA'), c.estranho.address),
        (e) => /PropostaInexistente/.test(e.message));
    });
    it('não admin não propõe, não concede e não revoga', async () => {
      for (const chamada of [
        c.acesso.connect(c.credorA).propor(PAPEL('PAPEL_PAUSA'), c.credorA.address),
        c.acesso.connect(c.credorA).conceder(PAPEL('PAPEL_ORACULO'), c.credorA.address),
        c.acesso.connect(c.credorA).revogar(PAPEL('PAPEL_ORACULO'), c.admin.address),
      ]) await assert.rejects(chamada, (e) => /SemPapel/.test(e.message));
    });
    it('expõe os sete papéis e a classificação de sensibilidade', async () => {
      const nomes = ['PAPEL_ORIGINADOR', 'PAPEL_ESPELHADOR', 'PAPEL_CONCILIADOR',
        'PAPEL_RECONCILIADOR_HUMANO', 'PAPEL_ORACULO', 'PAPEL_PAUSA', 'PAPEL_ADMIN'];
      for (const n of nomes) assert.equal(await c.acesso[n](), PAPEL(n));
      assert.equal(await c.acesso.papelSensivel(PAPEL('PAPEL_ORACULO')), false);
      assert.equal(await c.acesso.papelSensivel(PAPEL('PAPEL_RECONCILIADOR_HUMANO')), true);
      assert.equal(await c.acesso.atrasoTimelock(), BigInt(ATRASO));
    });
  });

  describe('cofre de garantias', () => {
    const politica = ethers.sha256(ethers.toUtf8Bytes('pol-1'));
    const niveis = () => Array.from({ length: 5 }, (_, i) => ({
      nivel: i + 1, rotuloHash: ethers.ZeroHash,
      capBps: [6000, 2500, 2000, 1500, 10000][i],
      haircutBps: [2500, 1000, 4000, 0, 3500][i],
      prazoRecuperacaoDias: [45, 90, 180, 30, 540][i],
    }));

    beforeEach(async () => {
      await emitir('CPR-1', 1_000_000n);
      await c.cofre.connect(c.compliance).configurarPolitica(politica, niveis());
      await c.cofre.connect(c.compliance).vincularPolitica(1n, politica);
    });

    it('recusa política com número de níveis diferente de cinco', async () => {
      await assert.rejects(
        c.cofre.connect(c.compliance).configurarPolitica(H('outra'), niveis().slice(0, 3)),
        (e) => /cinco niveis/.test(e.message));
    });
    it('recusa nível fora de ordem e nível inválido', async () => {
      const fora = niveis(); fora[2].nivel = 5;
      await assert.rejects(c.cofre.connect(c.compliance).configurarPolitica(H('o2'), fora),
        (e) => /NivelInvalido/.test(e.message));
      await assert.rejects(
        c.cofre.connect(c.compliance).vincularGarantia(1n, H('g'), 6, 1n),
        (e) => /NivelInvalido/.test(e.message));
    });
    it('recusa política inexistente', async () => {
      await assert.rejects(c.cofre.connect(c.compliance).vincularPolitica(1n, H('nao-existe')),
        (e) => /PoliticaInexistente/.test(e.message));
      await assert.rejects(c.cofre.percorrerWaterfall(99n, 1n),
        (e) => /PoliticaInexistente/.test(e.message));
    });
    it('recusa garantia duplicada e libera a existente', async () => {
      await c.cofre.connect(c.compliance).vincularGarantia(1n, H('g1'), 1, 100n);
      await assert.rejects(c.cofre.connect(c.compliance).vincularGarantia(1n, H('g1'), 2, 50n),
        (e) => /GarantiaJaVinculada/.test(e.message));
      await c.cofre.connect(c.compliance).liberarGarantia(H('g1'), H('motivo'));
      await assert.rejects(c.cofre.connect(c.compliance).liberarGarantia(H('g1'), H('m')),
        (e) => /garantia inexistente/.test(e.message));
    });
    it('registra excussão e expõe estado, nível e política', async () => {
      await c.cofre.connect(c.compliance).vincularGarantia(1n, H('g1'), 1, 400_000n);
      await c.cofre.connect(c.compliance).registrarExcussao(H('g1'), 3, 310_000n, H('ev'));
      assert.equal(await c.cofre.estadoDaExcussao(H('g1')), 3n);
      assert.equal(await c.cofre.nivelDaGarantia(H('g1')), 1n);
      assert.equal(await c.cofre.politicaDo(1n), politica);
      assert.deepEqual([...await c.cofre.garantiasDo(1n)], [H('g1')]);
      assert.equal((await c.cofre.niveisDaPolitica(politica)).length, 5);
      await assert.rejects(c.cofre.connect(c.compliance).registrarExcussao(H('nao'), 3, 1n, H('e')),
        (e) => /garantia inexistente/.test(e.message));
    });
    it('o teto do nível limita a absorção, e a perda residual sobra', async () => {
      // 900.000 de penhor com deságio de 25% daria 675.000, mas o teto do
      // nível 1 é 60% da exposição de 1.000.000 — logo 600.000.
      await c.cofre.connect(c.compliance).vincularGarantia(1n, H('g1'), 1, 900_000n);
      const r = await c.cofre.percorrerWaterfall(1n, 800_000n);
      assert.equal(r.absorcoes[0].absorvido, 600_000n);
      assert.equal(r.absorcoes[0].esgotado, true);
      assert.equal(r.perdaResidual, 200_000n, 'o que nenhum nível absorve precisa aparecer como residual');
    });
    it('níveis sem garantia não absorvem e não se dizem esgotados', async () => {
      const r = await c.cofre.percorrerWaterfall(1n, 100n);
      for (const a of r.absorcoes) {
        assert.equal(a.absorvido, 0n);
        assert.equal(a.esgotado, false);
      }
      assert.equal(r.perdaResidual, 100n);
    });
    it('só o originador mexe no cofre', async () => {
      await assert.rejects(c.cofre.connect(c.credorA).vincularGarantia(1n, H('x'), 1, 1n),
        (e) => /SemPapel/.test(e.message));
    });
  });

  describe('atualização', () => {
    it('recusa proposta inexistente e implementação sem código', async () => {
      await assert.rejects(c.espelho.executarAtualizacao(c.estranho.address),
        (e) => /proposta inexistente/.test(e.message));
      await c.espelho.proporAtualizacao(c.estranho.address);
      await avancar(ATRASO + 1);
      await assert.rejects(c.espelho.executarAtualizacao(c.estranho.address),
        (e) => /implementacao sem codigo/.test(e.message),
        'apontar o proxy para conta sem código travaria o contrato');
    });
    it('não admin não propõe atualização', async () => {
      await assert.rejects(c.espelho.connect(c.credorA).proporAtualizacao(c.credorA.address),
        (e) => /SemPapel/.test(e.message));
    });
    it('não pausa quem não tem o papel', async () => {
      await assert.rejects(c.espelho.connect(c.credorA).pausar(true), (e) => /SemPapel/.test(e.message));
    });
    it('pausa bloqueia emissão, baixa e atualização de hash', async () => {
      await emitir('CPR-1', 10n);
      await c.espelho.connect(c.admin).pausar(true);
      await assert.rejects(emitir('CPR-2'), (e) => /Pausa/.test(e.message));
      await assert.rejects(c.espelho.connect(c.espelhador).baixar(1n, H('c')), (e) => /Pausa/.test(e.message));
      await assert.rejects(
        c.espelho.connect(c.espelhador).atualizarHashDocumental(1n, H('n'), H('o')),
        (e) => /Pausa/.test(e.message));
    });
  });
});
