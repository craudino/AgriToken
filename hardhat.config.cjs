// Configuração do ambiente EVM local (A7 + A1).
// O briefing pede quatro validadores Besu/QBFT em Docker; o ambiente desta
// sessão não tem Docker, e o desvio está registrado no ADR-0008. A camada de
// contrato é idêntica — mesma EVM, mesmo bytecode, mesmas ABIs congeladas.
require('@nomicfoundation/hardhat-ethers');
require('solidity-coverage');
const { subtask } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');
const path = require('node:path');

// O ambiente não alcança binaries.soliditylang.org. Em vez de desligar
// verificação de rede — o que seria trocar um problema por outro pior —,
// apontamos para o solc já instalado como dependência, cuja versão é fixada no
// package.json e entra no lockfile. Assim a compilação é reprodutível (P6) e
// não depende de download em tempo de build.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === '0.8.28') {
    return {
      compilerPath: path.join(__dirname, 'node_modules/solc/soljson.js'),
      isSolcJs: true,
      version: args.solcVersion,
      longVersion: '0.8.28+commit.7893614a',
    };
  }
  return runSuper();
});

module.exports = {
  solidity: {
    version: '0.8.28',
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: false },
  },
  paths: {
    sources: './contracts',
    tests: './test/chain',
    cache: './artifacts/cache',
    artifacts: './artifacts/out',
  },
  networks: {
    hardhat: { chainId: 31337, mining: { auto: true } },
    local: { url: 'http://127.0.0.1:8545', chainId: 31337 },
  },
};
