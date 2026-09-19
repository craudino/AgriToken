#!/usr/bin/env node
// Toda rota precisa declarar escopo, ou ser marcada pública de propósito.
//
// A guarda já recusa rota sem escopo em tempo de execução, mas descobrir isso
// em produção é descobrir tarde. Aqui a verificação é estática: rota nova sem
// decorador não passa no CI.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ALVOS = ['services', 'infra/simulador-registradora'];

const controladores = [];
const varrer = (dir) => {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (relative(RAIZ, caminho).includes('node_modules') || nome === 'dist') continue;
    if (statSync(caminho).isDirectory()) varrer(caminho);
    else if (nome.endsWith('.controller.ts')) controladores.push(caminho);
  }
};
for (const a of ALVOS) varrer(join(RAIZ, a));

const falhas = [];
let rotas = 0, publicas = 0;
const porEscopo = new Map();

for (const arquivo of controladores) {
  const linhas = readFileSync(arquivo, 'utf8').split('\n');
  linhas.forEach((linha, i) => {
    const m = linha.match(/^\s*@(Get|Post|Put|Patch|Delete)\('([^']*)'\)/);
    if (!m) return;
    rotas++;
    // Decoradores anteriores, até a linha em branco ou o fim do bloco anterior.
    const anteriores = [];
    for (let j = i - 1; j >= 0 && linhas[j].trim().startsWith('@'); j--) anteriores.push(linhas[j]);
    const texto = anteriores.join('\n');
    const escopo = texto.match(/@Escopos\('([^']+)'\)/);
    if (texto.includes('@Publica()')) {
      publicas++;
      // Sondas de orquestrador não carregam credencial, e são as únicas rotas
      // abertas. Ambas devolvem veredicto sem detalhe — o teste de que não
      // vazam estado está em aceite-auth.
      const SONDAS = ['/saude', '/saude/pronto'];
      if (!SONDAS.includes(m[2])) {
        falhas.push(`${relative(RAIZ, arquivo)}:${i + 1} — ${m[1]} ${m[2]} está pública; só ${SONDAS.join(' e ')} podem estar`);
      }
      return;
    }
    if (!escopo) {
      falhas.push(`${relative(RAIZ, arquivo)}:${i + 1} — ${m[1]} ${m[2]} sem @Escopos nem @Publica`);
      return;
    }
    porEscopo.set(escopo[1], (porEscopo.get(escopo[1]) ?? 0) + 1);

    // Rota de simulação só pode exigir o escopo de simulador: se exigisse
    // outro, existiria fora de desenvolvimento com credencial comum.
    if (m[2].startsWith('/sim/') && escopo[1] !== 'simulador:operar') {
      falhas.push(`${relative(RAIZ, arquivo)}:${i + 1} — rota de simulação com escopo ${escopo[1]}`);
    }
    // E o inverso: escopo de simulador em rota que não é de simulação abriria
    // superfície de teste na API de verdade.
    if (!m[2].startsWith('/sim/') && escopo[1] === 'simulador:operar') {
      falhas.push(`${relative(RAIZ, arquivo)}:${i + 1} — escopo de simulador em rota comum`);
    }
  });
}

console.log(`escopos: ${rotas} rotas em ${controladores.length} controladores, ${publicas} pública(s)`);
for (const [e, n] of [...porEscopo].sort()) console.log(`  ${e.padEnd(28)} ${n}`);

if (falhas.length) {
  console.error('\nAutorização NÃO conforme:');
  for (const f of falhas) console.error('  - ' + f);
  process.exit(1);
}
console.log('\nOK  toda rota declara escopo, e só /saude é pública');
