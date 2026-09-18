// Implanta o conjunto e distribui os papéis. Escreve infra/enderecos.json, que
// é o contrato de fronteira entre A1 e os serviços.
//
// O timelock de 72 horas do ADR-0004 vale em produção. Aqui ele é reduzido por
// variável de ambiente para que a demonstração caiba em uma execução — e o
// valor efetivo é gravado no arquivo de endereços, para que ninguém confunda o
// ambiente de desenvolvimento com o de produção.
const { ethers } = require('hardhat');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const PAPEL = (n) => ethers.keccak256(ethers.toUtf8Bytes(n));

async function main() {
  const atraso = Number(process.env.TIMELOCK_SEG ?? 5);
  const [admin, espelhador, conciliador, reconciliador, compliance, credor1, credor2] = await ethers.getSigners();

  const acesso = await (await ethers.getContractFactory('ControleAcesso')).deploy(admin.address, atraso);
  const participantes = await (await ethers.getContractFactory('RegistroParticipantes'))
    .deploy(await acesso.getAddress());
  const espelho = await (await ethers.getContractFactory('EspelhoCPR')).deploy();
  const ancora = await (await ethers.getContractFactory('AncoraRegistro')).deploy(await espelho.getAddress());
  await (await espelho.inicializar(
    await acesso.getAddress(), await participantes.getAddress(), await ancora.getAddress())).wait();
  const cofre = await (await ethers.getContractFactory('CofreGarantias'))
    .deploy(await acesso.getAddress(), await espelho.getAddress());

  await (await acesso.conceder(PAPEL('PAPEL_ORIGINADOR'), compliance.address)).wait();
  await (await acesso.conceder(PAPEL('PAPEL_CONCILIADOR'), conciliador.address)).wait();
  await (await acesso.conceder(PAPEL('PAPEL_ORACULO'), admin.address)).wait();

  for (const [papel, conta] of [
    ['PAPEL_ESPELHADOR', espelhador.address],
    ['PAPEL_RECONCILIADOR_HUMANO', reconciliador.address],
    ['PAPEL_PAUSA', admin.address],
  ]) {
    await (await acesso.propor(PAPEL(papel), conta)).wait();
  }
  await ethers.provider.send('evm_increaseTime', [atraso + 1]);
  await ethers.provider.send('evm_mine', []);
  for (const [papel, conta] of [
    ['PAPEL_ESPELHADOR', espelhador.address],
    ['PAPEL_RECONCILIADOR_HUMANO', reconciliador.address],
    ['PAPEL_PAUSA', admin.address],
  ]) {
    await (await acesso.executarProposta(PAPEL(papel), conta)).wait();
  }

  const saida = {
    gerado_em: new Date().toISOString(),
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    timelock_segundos: atraso,
    aviso: atraso < 3600
      ? 'TIMELOCK REDUZIDO — ambiente de desenvolvimento. Em produção são 72 horas (ADR-0004).'
      : null,
    enderecos: {
      controleAcesso: await acesso.getAddress(),
      registroParticipantes: await participantes.getAddress(),
      espelhoCPR: await espelho.getAddress(),
      ancoraRegistro: await ancora.getAddress(),
      cofreGarantias: await cofre.getAddress(),
    },
    contas: {
      admin: admin.address,
      espelhador: espelhador.address,
      conciliador: conciliador.address,
      reconciliador: reconciliador.address,
      compliance: compliance.address,
      credor1: credor1.address,
      credor2: credor2.address,
    },
  };
  const destino = join(__dirname, '../../infra/enderecos.json');
  writeFileSync(destino, JSON.stringify(saida, null, 2) + '\n');
  console.log(JSON.stringify(saida.enderecos, null, 2));
  console.log(`timelock=${atraso}s  -> infra/enderecos.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
