// Passo 4 de G2: rota declarada (OpenAPI congelado) x rota implementada (controlador).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const YAML = createRequire('/home/user/AgriToken/package.json')('yaml');
const RAIZ = '/home/user/AgriToken';
const MAPA = {
  'core.yaml': 'services/core/src/app.controller.ts',
  'oracle.yaml': 'services/oracle/src/app.controller.ts',
  'eudr.yaml': 'services/eudr/src/app.controller.ts',
  'compliance.yaml': 'services/compliance/src/app.controller.ts',
  'registradora.yaml': 'infra/simulador-registradora/src/app.controller.ts',
};
const norm = (r) => r.replace(/\{[^}]+\}/g, ':p').replace(/:[A-Za-z_]+/g, ':p').replace(/\/$/, '');
let totalD = 0, totalI = 0, divergencias = 0;
for (const [yaml, ctrl] of Object.entries(MAPA)) {
  const doc = YAML.parse(readFileSync(join(RAIZ, 'docs/contracts/openapi', yaml), 'utf8'));
  const base = '';
  const declaradas = new Set();
  for (const [rota, item] of Object.entries(doc.paths ?? {}))
    for (const m of ['get','post','put','patch','delete'])
      if (item[m]) declaradas.add(`${m.toUpperCase()} ${norm(base + rota)}`);

  const fonte = readFileSync(join(RAIZ, ctrl), 'utf8');
  const implementadas = new Set();
  for (const m of fonte.matchAll(/@(Get|Post|Put|Patch|Delete)\('([^']*)'\)/g))
    implementadas.add(`${m[1].toUpperCase()} ${norm(m[2])}`);

  const soDecl = [...declaradas].filter((r) => !implementadas.has(r));
  const soImpl = [...implementadas].filter((r) => !declaradas.has(r));
  totalD += declaradas.size; totalI += implementadas.size;
  divergencias += soDecl.length + soImpl.length;
  console.log(`\n${yaml}  declaradas=${declaradas.size} implementadas=${implementadas.size}`);
  for (const r of soDecl) console.log(`   DECLARADA E NÃO IMPLEMENTADA   ${r}`);
  for (const r of soImpl) console.log(`   IMPLEMENTADA E NÃO DECLARADA   ${r}`);
  if (!soDecl.length && !soImpl.length) console.log('   sem divergência');
}
console.log(`\ntotal: ${totalD} declaradas, ${totalI} implementadas, ${divergencias} divergências`);
