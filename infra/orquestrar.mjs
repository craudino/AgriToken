#!/usr/bin/env node
// Runner único do ambiente de desenvolvimento (A7).
//
//   node infra/orquestrar.mjs subir     sobe banco, nó EVM e serviços
//   node infra/orquestrar.mjs descer    derruba tudo pelo pidfile
//   node infra/orquestrar.mjs estado    diz o que está de pé
//
// Usa pidfile em vez de pkill por padrão: `pkill -f` casa com a própria linha
// de comando de quem chama e derruba o chamador junto — erro barato de cometer
// e caro de depurar.
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, openSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUN = join(RAIZ, '.run');
mkdirSync(RUN, { recursive: true });

const SERVICOS = [
  { nome: 'registradora', cmd: ['node', 'infra/simulador-registradora/dist/main.js'], porta: 3005 },
  { nome: 'compliance', cmd: ['node', 'services/compliance/dist/main.js'], porta: 3001 },
  { nome: 'oracle', cmd: ['node', 'services/oracle/dist/main.js'], porta: 3002 },
  { nome: 'eudr', cmd: ['node', 'services/eudr/dist/main.js'], porta: 3004 },
  { nome: 'core', cmd: ['node', 'services/core/dist/main.js'], porta: 3003 },
  { nome: 'web', cmd: ['npx', 'next', 'start', 'apps/web', '-p', '3000'], porta: 3000 },
];

const pidfile = (n) => join(RUN, `${n}.pid`);
const logfile = (n) => join(RUN, `${n}.log`);

const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// npx e next start criam processos filhos: o pid do lançador pode morrer com o
// serviço de pé, e o pidfile passa a mentir. A porta é a fonte de verdade sobre
// o que está no ar.
const portaViva = async (porta) => {
  try {
    const c = await fetch(`http://127.0.0.1:${porta}/`, { signal: AbortSignal.timeout(800) });
    return c.status > 0;
  } catch {
    return false;
  }
};

const pidDe = (n) => {
  if (!existsSync(pidfile(n))) return null;
  const pid = Number(readFileSync(pidfile(n), 'utf8').trim());
  return vivo(pid) ? pid : null;
};

const ambiente = () => {
  const env = { ...process.env };
  const arquivo = join(RAIZ, '.env');
  if (existsSync(arquivo)) {
    for (const linha of readFileSync(arquivo, 'utf8').split('\n')) {
      const m = linha.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) env[m[1]] = m[2];
    }
  }
  return env;
};

const iniciar = (s) => {
  if (pidDe(s.nome)) { console.log(`${s.nome}: já de pé`); return; }
  const saida = openSync(logfile(s.nome), 'a');
  const p = spawn(s.cmd[0], s.cmd.slice(1), {
    cwd: RAIZ, env: ambiente(), detached: true, stdio: ['ignore', saida, saida],
  });
  p.unref();
  writeFileSync(pidfile(s.nome), String(p.pid));
  console.log(`${s.nome}: pid ${p.pid}, porta ${s.porta}`);
};

const parar = (nome) => {
  const pid = pidDe(nome);
  if (!pid) { rmSync(pidfile(nome), { force: true }); return false; }
  try { process.kill(pid, 'SIGTERM'); } catch {}
  rmSync(pidfile(nome), { force: true });
  return true;
};

const comando = process.argv[2] ?? 'estado';

if (comando === 'subir') {
  console.log('== banco ==');
  execSync('bash infra/db/subir-local.sh', { cwd: RAIZ, stdio: 'inherit' });
  console.log('== nó EVM ==');
  if (!pidDe('evm')) {
    const saida = openSync(logfile('evm'), 'a');
    const p = spawn('npx', ['hardhat', 'node'], { cwd: RAIZ, env: ambiente(), detached: true, stdio: ['ignore', saida, saida] });
    p.unref();
    writeFileSync(pidfile('evm'), String(p.pid));
    console.log(`evm: pid ${p.pid}, porta 8545`);
    await new Promise((r) => setTimeout(r, 6000));
    execSync('npx hardhat run contracts/scripts/implantar.cjs --network local', { cwd: RAIZ, stdio: 'inherit', env: ambiente() });
  } else {
    console.log('evm: já de pé');
  }
  console.log('== serviços ==');
  for (const s of SERVICOS) iniciar(s);
} else if (comando === 'descer') {
  for (const n of [...SERVICOS.map((s) => s.nome), 'evm']) {
    console.log(`${n}: ${parar(n) ? 'parado' : 'não estava de pé'}`);
  }
} else {
  for (const s of [...SERVICOS, { nome: 'evm', porta: 8545 }]) {
    const pid = pidDe(s.nome);
    const naPorta = await portaViva(s.porta);
    const estado = pid ? `pid ${pid}` : naPorta ? 'de pé (pid perdido)' : 'parado';
    console.log(`${s.nome.padEnd(14)} ${estado.padEnd(22)} porta ${s.porta} ${naPorta ? 'respondendo' : '-'}`);
  }
}
