import { Injectable } from '@nestjs/common';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { poolOps, emTransacao, hashPayload, canonico, Contexto, log, comCusto, invalido } from '@cpr/nucleo';

const CAMINHO_MASSA = join(__dirname, '../../../infra/dados/massa.json');

/**
 * Ingestão e validação de polígonos. A validação topológica é feita pelo
 * PostGIS, não por código de aplicação: o cruzamento precisa ser auditável e
 * reproduzível (P6), e "confia no meu loop" não é evidência.
 */
@Injectable()
export class GeoService {
  /** Carrega as bases de desmatamento da massa sintética. Idempotente. */
  async carregarBases(ctx: Contexto) {
    if (!existsSync(CAMINHO_MASSA)) return { carregados: 0, motivo: 'massa ausente' };
    const massa = JSON.parse(readFileSync(CAMINHO_MASSA, 'utf8')) as {
      desmatamento: Array<{ id: string; base: string; ano: number; geometria: number[][][] }>;
    };
    let n = 0;
    for (const d of massa.desmatamento) {
      const { rows } = await poolOps().query<{ id: string }>(
        'SELECT id FROM ops.base_referencia_geo WHERE codigo = $1 ORDER BY versao DESC LIMIT 1', [d.base]);
      if (!rows.length) continue;
      await poolOps().query(
        `INSERT INTO geo.desmatamento (id, base_id, ano_deteccao, geometria)
         VALUES ($1,$2,$3, ST_Multi(ST_GeomFromGeoJSON($4)))
         ON CONFLICT (base_id, id) DO NOTHING`,
        [d.id, rows[0].id, d.ano, JSON.stringify({ type: 'Polygon', coordinates: d.geometria })]);
      n++;
    }
    log.info(ctx, 'bases de desmatamento carregadas', { poligonos: n });
    return { carregados: n };
  }

  /**
   * Ingere o polígono. Recusa geometria inválida em vez de "corrigir": um
   * polígono autointersectante corrigido em silêncio produz área errada, e a
   * área errada vira colateral errado.
   */
  async ingerir(ctx: Contexto, entrada: {
    produtor_ref: string; talhao_id?: string; apelido?: string;
    commodity: 'CAFE_ARABICA' | 'CAFE_CONILON'; area_declarada_ha: number;
    geometria: { type: string; coordinates: unknown };
  }) {
    const { rows: p } = await poolOps().query<{ id: string }>(
      'SELECT id FROM ops.produtor WHERE ref_opaca = $1', [Buffer.from(entrada.produtor_ref, 'hex')]);
    if (!p.length) throw invalido('produtor desconhecido');

    const geojson = JSON.stringify(entrada.geometria);
    const { rows: v } = await poolOps().query<{
      valido: boolean; motivo: string | null; area_ha: string; lat: number; lon: number; hash: string;
    }>(
      `WITH g AS (SELECT ST_Multi(ST_GeomFromGeoJSON($1)) AS geom)
       SELECT ST_IsValid(geom) AS valido,
              ST_IsValidReason(geom) AS motivo,
              ST_Area(geom::geography) / 10000 AS area_ha,
              ST_Y(ST_Centroid(geom)) AS lat,
              ST_X(ST_Centroid(geom)) AS lon,
              encode(digest(ST_AsBinary(ST_ReducePrecision(geom, 0.000001)), 'sha256'), 'hex') AS hash
         FROM g`, [geojson]);
    const r = v[0];
    if (!r.valido) throw invalido(`geometria inválida: ${r.motivo}`);

    const areaCalculada = Number(r.area_ha);
    const desvio = Math.abs(areaCalculada - entrada.area_declarada_ha) / entrada.area_declarada_ha;
    if (desvio > 0.2) {
      throw invalido(
        `área declarada (${entrada.area_declarada_ha} ha) diverge da geometria ` +
        `(${areaCalculada.toFixed(2)} ha) em ${(desvio * 100).toFixed(1)}%`);
    }

    const talhaoId = entrada.talhao_id ?? crypto.randomUUID();
    return comCusto(poolOps(),
      { etapa: 'POLIGONO_INGESTAO', sujeitoTipo: 'TALHAO', sujeitoId: talhaoId,
        automatica: true, tarifaCentavos: 0 },
      async () => emTransacao(poolOps(), async (cli) => {
        const { rows: t } = await cli.query<{ id: string; poligono_versao: number }>(
          `INSERT INTO ops.talhao (id, produtor_id, apelido, car_ref, car_hash, area_declarada_ha,
                                   area_calculada_ha, commodity, poligono_hash, poligono_versao)
           VALUES ($1,$2,$3,$4, digest($5,'sha256'), $6,$7,$8, decode($9,'hex'), 1)
           ON CONFLICT (id) DO UPDATE
             SET area_calculada_ha = EXCLUDED.area_calculada_ha,
                 poligono_hash = EXCLUDED.poligono_hash,
                 poligono_versao = ops.talhao.poligono_versao + 1,
                 atualizado_em = now()
           RETURNING id, poligono_versao`,
          [talhaoId, p[0].id, entrada.apelido ?? null, crypto.randomUUID(), `car-${talhaoId}`,
           entrada.area_declarada_ha, areaCalculada.toFixed(4), entrada.commodity, r.hash]);

        await cli.query(
          `INSERT INTO geo.talhao_geometria (talhao_id, versao, geometria, origem, valido_topo)
           VALUES ($1,$2, ST_Multi(ST_GeomFromGeoJSON($3)), $4, true)
           ON CONFLICT (talhao_id, versao) DO NOTHING`,
          [t[0].id, t[0].poligono_versao, geojson, 'UPLOAD_GEOJSON']);

        // Centroide ofuscado para exibição a terceiros: ruído de no mínimo 5 km,
        // porque coordenada exata de talhão reidentifica o produtor (P2).
        const raio = 5000;
        const angulo = Math.random() * 2 * Math.PI;
        const dLat = (raio * Math.cos(angulo)) / 111_320;
        const dLon = (raio * Math.sin(angulo)) / (111_320 * Math.cos((r.lat * Math.PI) / 180));
        await cli.query(
          `INSERT INTO geo.talhao_ofuscado (talhao_id, centroide_aprox, raio_ruido_m)
           VALUES ($1, ST_SetSRID(ST_MakePoint($2,$3),4326), $4)
           ON CONFLICT (talhao_id) DO UPDATE SET centroide_aprox = EXCLUDED.centroide_aprox, gerado_em = now()`,
          [t[0].id, r.lon + dLon, r.lat + dLat, raio]);

        log.info(ctx, 'talhão ingerido', { talhao_id: t[0].id, area_ha: areaCalculada.toFixed(2) });
        return {
          id: t[0].id, produtor_ref: entrada.produtor_ref, apelido: entrada.apelido ?? null,
          area_declarada_ha: entrada.area_declarada_ha, area_calculada_ha: Number(areaCalculada.toFixed(4)),
          commodity: entrada.commodity, poligono_hash: '0x' + r.hash, poligono_versao: t[0].poligono_versao,
          topologia_valida: true,
        };
      }));
  }

  async metadados(talhaoId: string) {
    const { rows } = await poolOps().query(
      `SELECT t.id, encode(p.ref_opaca,'hex') AS produtor_ref, t.apelido, t.area_declarada_ha,
              t.area_calculada_ha, t.commodity, encode(t.poligono_hash,'hex') AS poligono_hash,
              t.poligono_versao, p.municipio_ibge,
              ST_Y(o.centroide_aprox) AS lat, ST_X(o.centroide_aprox) AS lon, o.raio_ruido_m
         FROM ops.talhao t
         JOIN ops.produtor p ON p.id = t.produtor_id
         LEFT JOIN geo.talhao_ofuscado o ON o.talhao_id = t.id
        WHERE t.id = $1`, [talhaoId]);
    if (!rows.length) return null;
    const r = rows[0];
    // Nunca devolve a geometria bruta: só hash e centroide ofuscado (P2).
    return {
      id: r.id, produtor_ref: r.produtor_ref, apelido: r.apelido,
      area_declarada_ha: Number(r.area_declarada_ha), area_calculada_ha: Number(r.area_calculada_ha),
      commodity: r.commodity, poligono_hash: '0x' + r.poligono_hash, poligono_versao: r.poligono_versao,
      municipio_ibge: r.municipio_ibge,
      centroide_ofuscado: r.lat ? { lat: r.lat, lon: r.lon, raio_ruido_m: r.raio_ruido_m } : null,
      topologia_valida: true,
    };
  }

  /** Geometria bruta: rota de operador, com finalidade declarada e registro. */
  async geometria(talhaoId: string, finalidade: string) {
    const { rows } = await poolOps().query<{ geojson: string }>(
      `SELECT ST_AsGeoJSON(geometria) AS geojson FROM geo.talhao_geometria
        WHERE talhao_id = $1 ORDER BY versao DESC LIMIT 1`, [talhaoId]);
    if (!rows.length) return null;
    await poolOps().query(
      `INSERT INTO ops.custo_verificacao (etapa, sujeito_tipo, sujeito_id, automatica,
                                          esforco_humano_seg, duracao_ms, sucesso)
       VALUES ('POLIGONO_VALIDACAO','TALHAO',$1,false,60,0,true)`, [talhaoId]);
    return { geojson: JSON.parse(rows[0].geojson), finalidade };
  }
}
