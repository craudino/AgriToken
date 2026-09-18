#!/usr/bin/env node
// Gera packages/nucleo/src/tipos.ts a partir dos artefatos congelados.
//
//   node infra/ci/gerar-tipos.mjs            verifica (falha se divergiu)
//   node infra/ci/gerar-tipos.mjs --gerar    regrava
//
// Tipo escrito à mão é tipo que diverge do contrato sem ninguém perceber — o
// risco de maior probabilidade da Seção 11 do briefing. Aqui o TypeScript é
// derivado do DDL e das OpenAPI, e o CI reprova a divergência.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DESTINO = join(RAIZ, 'packages/nucleo/src/tipos.ts');
const GERAR = process.argv.includes('--gerar');

const ddl = readFileSync(join(RAIZ, 'docs/contracts/db/ops/020_dominios_e_enums.sql'), 'utf8')
  .replace(/--[^\n]*/g, '');
const ddlCusto = readFileSync(join(RAIZ, 'docs/contracts/db/ops/110_instrumentacao_custo.sql'), 'utf8')
  .replace(/--[^\n]*/g, '');

const enumSql = (fonte, nome) => {
  const bloco = fonte.match(new RegExp(`CREATE TYPE ops\\.${nome} AS ENUM \\(([^)]*)\\)`, 's'));
  if (!bloco) throw new Error(`enum ops.${nome} não encontrado`);
  return [...bloco[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
};

const uniao = (nome, valores) =>
  `export type ${nome} =\n${valores.map((v) => `  | '${v}'`).join('\n')};\n`;

const mapa = [
  ['EstadoContrato', enumSql(ddl, 'estado_contrato')],
  ['SituacaoConciliacao', enumSql(ddl, 'situacao_conciliacao')],
  ['TipoDivergencia', enumSql(ddl, 'tipo_divergencia')],
  ['Severidade', enumSql(ddl, 'severidade')],
  ['EstadoDivergencia', enumSql(ddl, 'estado_divergencia')],
  ['TipoGarantia', enumSql(ddl, 'tipo_garantia')],
  ['EstadoExcussao', enumSql(ddl, 'estado_excussao')],
  ['TipoLeitura', enumSql(ddl, 'tipo_leitura')],
  ['EstadoLeitura', enumSql(ddl, 'estado_leitura')],
  ['CriticidadeLeitura', enumSql(ddl, 'criticidade_leitura')],
  ['ResultadoEudr', enumSql(ddl, 'resultado_eudr')],
  ['EstadoDds', enumSql(ddl, 'estado_dds')],
  ['PorteProdutor', enumSql(ddl, 'porte_produtor')],
  ['SituacaoKyc', enumSql(ddl, 'situacao_kyc')],
  ['Commodity', enumSql(ddl, 'commodity')],
  ['EtapaVerificacao', enumSql(ddlCusto, 'etapa_verificacao')],
];

const cabecalho = `// GERADO POR infra/ci/gerar-tipos.mjs — NÃO EDITE À MÃO.
// Derivado dos artefatos congelados em docs/contracts/. Para mudar um valor,
// altere o contrato e abra solicitação em docs/contracts/MUDANCAS.md.
`;

const corpo = cabecalho + '\n' + mapa.map(([n, v]) => uniao(n, v)).join('\n') + `
/** Transições permitidas, na mesma ordem em que o DDL as insere. */
export const TRANSICOES_PERMITIDAS: ReadonlyArray<
  readonly [EstadoContrato, EstadoContrato, string]
> = [
${[...readFileSync(join(RAIZ, 'docs/contracts/db/ops/040_contrato_espelhado.sql'), 'utf8')
    .matchAll(/\('([A-Z_]+)',\s*'([A-Z_]+)',\s*'([a-z_]+)'\)/g)]
    .map((m) => `  ['${m[1]}', '${m[2]}', '${m[3]}'],`).join('\n')}
] as const;

/** Política de severidade por tipo de divergência, conforme o DDL. */
export const POLITICA_DIVERGENCIA: ReadonlyArray<{
  tipo: TipoDivergencia; severidade: Severidade; congela: boolean; slaDeteccao: string; acao: string;
}> = [
${[...readFileSync(join(RAIZ, 'docs/contracts/db/ops/080_conciliacao.sql'), 'utf8')
    .matchAll(/\('([A-Z_]+)',\s*'([A-Z]+)',\s*(true|false),\s*interval '([^']+)',\s*'([A-Z_]+)'\)/g)]
    .map((m) => `  { tipo: '${m[1]}', severidade: '${m[2]}', congela: ${m[3]}, slaDeteccao: '${m[4]}', acao: '${m[5]}' },`)
    .join('\n')}
];
`;

// O catálogo de eventos também entra como código gerado: importar o JSON de
// fora do rootDir quebraria a compilação, e ler do disco em runtime deixaria o
// serviço aceitar um catálogo diferente do congelado.
const catalogo = JSON.parse(readFileSync(join(RAIZ, 'docs/contracts/events/catalogo.json'), 'utf8'));
const DESTINO_CAT = join(RAIZ, 'packages/nucleo/src/catalogo-eventos.ts');
const corpoCat = cabecalho + `
export interface EntradaCatalogo {
  tipo: string;
  produtor: string;
  consumidores: string[];
  sujeito: string;
  auditavel: boolean;
  exige_evidencia: boolean;
}

export const CATALOGO_EVENTOS: ReadonlyArray<EntradaCatalogo> = [
${catalogo.eventos.map((e) => '  ' + JSON.stringify(e) + ',').join('\n')}
];
`;

if (GERAR) {
  writeFileSync(DESTINO, corpo);
  writeFileSync(DESTINO_CAT, corpoCat);
  console.log(`tipos gerados: ${mapa.length} uniões, ${corpo.split('\n').length} linhas`);
} else {
  let divergiu = false;
  for (const [caminho, esperado] of [[DESTINO, corpo], [DESTINO_CAT, corpoCat]]) {
    if (readFileSync(caminho, 'utf8') !== esperado) {
      console.error(`[P6] ${caminho} divergiu dos contratos congelados.`);
      divergiu = true;
    }
  }
  if (divergiu) {
    console.error('     Rode: node infra/ci/gerar-tipos.mjs --gerar');
    process.exit(1);
  }
  console.log('OK  P6: tipos e catálogo derivados dos contratos congelados, sem divergência');
}
