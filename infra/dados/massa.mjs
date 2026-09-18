#!/usr/bin/env node
// Gerador de massa sintética. Determinístico por semente (P6): a mesma semente
// produz o mesmo conjunto, byte a byte, para que um resultado de demonstração
// seja reproduzível por quem duvidar dele.
//
// Sobre realismo: a distribuição de porte segue o perfil da cafeicultura do Sul
// de Minas descrito no briefing (predominância de pequenas propriedades). Os
// códigos de município são SINTÉTICOS, no formato do IBGE para Minas Gerais
// (31xxxxx), e não correspondem a municípios reais — usar código real
// associaria produtor fictício a lugar existente sem necessidade. [#REF]
// As geometrias são reais em forma e anonimizadas em localização, conforme a
// Seção 6.3 do briefing.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SEMENTE = Number(process.env.SEMENTE ?? 20260918);

const prng = (s) => () => {
  s |= 0; s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let semente = SEMENTE;
const r = () => { semente = (semente * 1664525 + 1013904223) % 4294967296; return prng(semente)(); };
const entre = (a, b) => a + r() * (b - a);
const inteiro = (a, b) => Math.floor(entre(a, b + 1));
const escolher = (a) => a[inteiro(0, a.length - 1)];

// --- documentos com dígito verificador válido, para exercitar o KYC de verdade
const digitosCpf = (base) => {
  const calc = (nums, pesoInicial) => {
    const soma = nums.reduce((acc, n, i) => acc + n * (pesoInicial - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = calc(base, 10);
  const d2 = calc([...base, d1], 11);
  return [...base, d1, d2].join('');
};
const cpf = () => digitosCpf(Array.from({ length: 9 }, () => inteiro(0, 9)));

const NOMES = ['Ana', 'João', 'Maria', 'Pedro', 'Luzia', 'Sebastião', 'Rita', 'Geraldo', 'Célia', 'Antônio'];
const SOBRENOMES = ['Ribeiro', 'Andrade', 'Pereira', 'Moreira', 'Nogueira', 'Silveira', 'Campos', 'Rezende'];

// Sul de Minas, deslocado: a região é plausível, o ponto não é o real.
const BASE_LAT = -21.52, BASE_LON = -45.47;

const poligonoQuadrado = (lat, lon, ladoGraus) => {
  const h = ladoGraus / 2;
  return [[
    [lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h], [lon - h, lat - h],
  ]];
};

// Área aproximada em hectares para polígono pequeno em graus decimais.
const areaHa = (ladoGraus, lat) => {
  const mLat = ladoGraus * 111_320;
  const mLon = ladoGraus * 111_320 * Math.cos((lat * Math.PI) / 180);
  return (mLat * mLon) / 10_000;
};

// --- desmatamento: polígonos posteriores à data de corte, para o cruzamento
const desmatamento = [
  { id: 'DESM-001', base: 'PRODES', ano: 2022, geometria: poligonoQuadrado(BASE_LAT + 0.20, BASE_LON + 0.20, 0.030) },
  { id: 'DESM-002', base: 'MAPBIOMAS', ano: 2023, geometria: poligonoQuadrado(BASE_LAT - 0.18, BASE_LON + 0.24, 0.022) },
  { id: 'DESM-003', base: 'PRODES', ano: 2019, geometria: poligonoQuadrado(BASE_LAT + 0.30, BASE_LON - 0.30, 0.025) },
];

const PORTE = [
  ['PEQUENO', 0.72, [2, 20]],     // predominância, conforme o briefing
  ['MEDIO', 0.22, [20, 80]],
  ['GRANDE', 0.06, [80, 400]],
];
const sortearPorte = () => {
  const x = r();
  let acc = 0;
  for (const [nome, peso, faixa] of PORTE) { acc += peso; if (x <= acc) return { nome, faixa }; }
  return { nome: 'PEQUENO', faixa: [2, 20] };
};

const produtores = [];
const talhoes = [];
const N = Number(process.env.N_PRODUTORES ?? 40);

for (let i = 0; i < N; i++) {
  const { nome: porte, faixa } = sortearPorte();
  const areaTotal = entre(faixa[0], faixa[1]);
  const p = {
    ref: `PROD-${String(i + 1).padStart(3, '0')}`,
    tipo_pessoa: porte === 'GRANDE' && r() < 0.5 ? 'PJ' : 'PF',
    nome: `${escolher(NOMES)} ${escolher(SOBRENOMES)}`,
    documento: cpf(),
    nascimento: `19${inteiro(50, 95)}-${String(inteiro(1, 12)).padStart(2, '0')}-${String(inteiro(1, 28)).padStart(2, '0')}`,
    contato: `+5535${inteiro(90000, 99999)}${inteiro(1000, 9999)}`,
    car_numero: `MG-31${inteiro(10000, 99999)}-${inteiro(100000, 999999).toString(16).toUpperCase()}`,
    porte,
    uf: 'MG',
    municipio_ibge: `31${String(inteiro(10000, 99999))}`,   // sintético [#REF]
    area_total_ha: Number(areaTotal.toFixed(2)),
    restricao: r() < 0.08 ? escolher(['LISTA_RESTRITIVA', 'EMBARGO_AMBIENTAL', 'CAR_INVALIDO']) : null,
  };
  produtores.push(p);

  // Um a três talhões por produtor, somando a área declarada.
  const n = porte === 'PEQUENO' ? 1 : inteiro(1, 3);
  for (let t = 0; t < n; t++) {
    const area = areaTotal / n;
    const lado = Math.sqrt((area * 10_000) / (111_320 * 111_320 * Math.cos((BASE_LAT * Math.PI) / 180)));
    // Três perfis deliberados: conforme, não conforme e limítrofe. Sem o
    // terceiro, o motor EUDR nunca é testado onde ele erra.
    const sorte = r();
    let centro;
    if (sorte < 0.12) centro = { lat: BASE_LAT + 0.20, lon: BASE_LON + 0.20, perfil: 'NAO_CONFORME' };
    else if (sorte < 0.22) {
      // Limítrofe de verdade: encosta com sobreposição de poucos metros, dentro
      // da margem de erro da base. Um polígono meramente adjacente não testa
      // nada — dá sobreposição zero e o motor acerta por acidente.
      const sobreposicaoGraus = 0.00008;   // ~9 m de faixa, ~0,3 ha
      centro = { lat: BASE_LAT + 0.20 + 0.0150 + lado / 2 - sobreposicaoGraus,
                 lon: BASE_LON + 0.20, perfil: 'LIMITROFE' };
    }
    else centro = { lat: BASE_LAT + entre(-0.6, 0.6), lon: BASE_LON + entre(-0.6, 0.6), perfil: 'CONFORME' };

    talhoes.push({
      ref: `${p.ref}-T${t + 1}`,
      produtor_ref: p.ref,
      apelido: escolher(['Sede', 'Baixada', 'Morro Alto', 'Grota', 'Chapada']) + ` ${t + 1}`,
      commodity: r() < 0.9 ? 'CAFE_ARABICA' : 'CAFE_CONILON',
      area_declarada_ha: Number(area.toFixed(4)),
      area_estimada_ha: Number(areaHa(lado, centro.lat).toFixed(4)),
      perfil_esperado: centro.perfil,
      geometria: { type: 'MultiPolygon', coordinates: [poligonoQuadrado(centro.lat, centro.lon, lado)] },
    });
  }
}

// --- série de preço: uma fonte por dia, três fontes correlacionadas mas não
// idênticas, mais o cenário de queda que estressa receita e colateral juntos.
const serie = [];
let preco = 1480;
for (let d = 0; d < 180; d++) {
  const data = new Date(Date.UTC(2026, 3, 1) + d * 86400000);
  const choque = d >= 120 && d < 150 ? -0.010 : 0;          // queda de ~26% em 30 dias
  preco = Math.max(600, preco * (1 + entre(-0.012, 0.012) + choque));
  serie.push({
    data: data.toISOString().slice(0, 10),
    CEPEA: Number(preco.toFixed(2)),
    B3_FUT: Number((preco * (1 + entre(-0.008, 0.008))).toFixed(2)),
    COOP_SUL: Number((preco * (1 + entre(-0.020, 0.005))).toFixed(2)),
    AGREGADOR_X: Number(preco.toFixed(2)),                   // republica o CEPEA
  });
}

const massa = {
  gerado_em: new Date().toISOString(),
  semente: SEMENTE,
  observacao: 'Massa sintética. Documentos têm dígito verificador válido para exercitar o KYC; nenhuma pessoa real é representada. Códigos de município são sintéticos.',
  produtores,
  talhoes,
  desmatamento,
  serie_preco: serie,
  cenarios: {
    quebra_sistemica: { choque_preco_pct: -26, quebra_produtividade_pct: -35, taxa_inadimplencia_pct: 18 },
    inadimplencia_isolada: { choque_preco_pct: 0, quebra_produtividade_pct: 0, taxa_inadimplencia_pct: 3 },
    queda_preco_excussao: { choque_preco_pct: -26, quebra_produtividade_pct: -5, taxa_inadimplencia_pct: 9 },
  },
};

const destino = join(AQUI, 'massa.json');
writeFileSync(destino, JSON.stringify(massa, null, 2) + '\n');

const porPorte = Object.fromEntries(PORTE.map(([n]) => [n, produtores.filter((p) => p.porte === n).length]));
const porPerfil = Object.fromEntries(['CONFORME', 'NAO_CONFORME', 'LIMITROFE']
  .map((p) => [p, talhoes.filter((t) => t.perfil_esperado === p).length]));
console.log(`massa gerada: ${produtores.length} produtores, ${talhoes.length} talhões`);
console.log('porte:', porPorte);
console.log('perfil EUDR esperado:', porPerfil);
console.log(`preço: ${serie[0].CEPEA} -> ${serie.at(-1).CEPEA} (mínimo ${Math.min(...serie.map((s) => s.CEPEA)).toFixed(2)})`);
