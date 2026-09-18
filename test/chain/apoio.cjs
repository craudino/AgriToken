// Apoio dos testes de invariante. Sobe o conjunto completo de contratos com os
// papéis já distribuídos, porque invariante testado em contrato isolado não
// prova nada sobre o sistema.
const { ethers } = require('hardhat');

const PAPEL = (n) => ethers.keccak256(ethers.toUtf8Bytes(n));
const ANCORA = (entidade, id) => ethers.sha256(ethers.toUtf8Bytes(`${entidade}|${id}`));
const ATRASO = 72 * 60 * 60; // 72 horas, ADR-0004

async function montar() {
  const [admin, espelhador, conciliador, reconciliador, compliance, credorA, credorB, estranho] =
    await ethers.getSigners();

  const acesso = await (await ethers.getContractFactory('ControleAcesso')).deploy(admin.address, ATRASO);
  const participantes = await (await ethers.getContractFactory('RegistroParticipantes')).deploy(await acesso.getAddress());
  const espelho = await (await ethers.getContractFactory('EspelhoCPR')).deploy();
  const ancora = await (await ethers.getContractFactory('AncoraRegistro')).deploy(await espelho.getAddress());
  await espelho.inicializar(await acesso.getAddress(), await participantes.getAddress(), await ancora.getAddress());
  const cofre = await (await ethers.getContractFactory('CofreGarantias'))
    .deploy(await acesso.getAddress(), await espelho.getAddress());

  // Papéis não sensíveis: concessão direta.
  await acesso.conceder(PAPEL('PAPEL_ORIGINADOR'), compliance.address);
  await acesso.conceder(PAPEL('PAPEL_CONCILIADOR'), conciliador.address);
  await acesso.conceder(PAPEL('PAPEL_ORACULO'), admin.address);

  // Papéis sensíveis: proposta e timelock. É o caminho, não um atalho de teste.
  for (const [papel, conta] of [
    ['PAPEL_ESPELHADOR', espelhador.address],
    ['PAPEL_RECONCILIADOR_HUMANO', reconciliador.address],
    ['PAPEL_PAUSA', admin.address],
  ]) {
    await acesso.propor(PAPEL(papel), conta);
  }
  await avancar(ATRASO + 1);
  for (const [papel, conta] of [
    ['PAPEL_ESPELHADOR', espelhador.address],
    ['PAPEL_RECONCILIADOR_HUMANO', reconciliador.address],
    ['PAPEL_PAUSA', admin.address],
  ]) {
    await acesso.executarProposta(PAPEL(papel), conta);
  }

  const validade = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  for (const c of [credorA, credorB]) {
    await participantes.connect(compliance)
      .habilitar(c.address, ethers.sha256(ethers.toUtf8Bytes(`kyc-${c.address}`)), validade);
  }

  return { acesso, participantes, espelho, ancora, cofre,
           admin, espelhador, conciliador, reconciliador, compliance, credorA, credorB, estranho };
}

async function avancar(segundos) {
  await ethers.provider.send('evm_increaseTime', [segundos]);
  await ethers.provider.send('evm_mine', []);
}

module.exports = { montar, avancar, PAPEL, ANCORA, ATRASO };
