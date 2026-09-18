import { Injectable } from '@nestjs/common';
import {
  poolOps, emTransacao, publicar, hashPayload, canonico, Contexto, log, comCusto, semQuorum, invalido,
} from '@cpr/nucleo';

const URL_ORACLE = process.env.URL_ORACLE ?? 'http://127.0.0.1:3002';

/**
 * Motor de conformidade EUDR.
 *
 * A data de corte é 31/12/2020 e vive na tabela da base, não no código: a
 * aplicação do Regulamento (UE) 2023/1115 já foi adiada mais de uma vez — a
 * mais recente pelo Regulamento (UE) 2025/2650, para 30/12/2026 (grandes
 * operadores) e 30/06/2027 (micro e pequenas). A data de corte não mudou nesses
 * adiamentos, mas o código precisa sobreviver a um próximo.
 *
 * Resultado LIMITROFE nunca vira CONFORME. Sobreposição dentro da margem de
 * erro da base é incerteza, e classificar incerteza como conformidade
 * contamina o colateral e a DDS emitida.
 */
@Injectable()
export class EudrService {
  private async cruzarBase(talhaoId: string, baseId: string) {
    const { rows } = await poolOps().query<{
      area_sobreposta_ha: string; base_codigo: string; versao: string; data_corte: Date;
      anos: number[]; margem_ha: string; resolucao_m: number;
    }>(
      `SELECT COALESCE(SUM(ST_Area(ST_Intersection(t.geometria, d.geometria)::geography)) / 10000, 0)
                AS area_sobreposta_ha,
              b.codigo AS base_codigo, b.versao, b.data_corte, b.resolucao_m,
              -- Margem de incerteza: o erro do cruzamento mora nas bordas, e a
              -- faixa duvidosa é o perímetro do talhão vezes meia resolução da
              -- base. Constante escolhida a dedo classificaria como conforme o
              -- que é apenas indistinguível.
              (ST_Perimeter(t.geometria::geography) * (b.resolucao_m / 2.0)) / 10000 AS margem_ha,
              COALESCE(array_agg(d.ano_deteccao) FILTER (WHERE d.id IS NOT NULL), '{}') AS anos
         FROM ops.base_referencia_geo b
         CROSS JOIN LATERAL (
           SELECT geometria FROM geo.talhao_geometria
            WHERE talhao_id = $1 ORDER BY versao DESC LIMIT 1) t
         LEFT JOIN geo.desmatamento d
                ON d.base_id = b.id
               AND ST_Intersects(t.geometria, d.geometria)
               AND make_date(d.ano_deteccao, 12, 31) > b.data_corte
        WHERE b.id = $2
        GROUP BY b.codigo, b.versao, b.data_corte, b.resolucao_m, t.geometria`, [talhaoId, baseId]);
    return rows[0];
  }

  /**
   * Avalia o talhão contra todas as bases e publica o resultado por fonte no
   * oráculo, que aplica o quórum por interseção (P4). Uma base apontando
   * problema já impede o resultado conforme — a redundância aqui serve para
   * não perder o alerta, não para tirar média.
   */
  async avaliar(ctx: Contexto, talhaoId: string) {
    const { rows: t } = await poolOps().query<{ poligono_hash: string; poligono_versao: number }>(
      `SELECT encode(poligono_hash,'hex') AS poligono_hash, poligono_versao
         FROM ops.talhao WHERE id = $1`, [talhaoId]);
    if (!t.length) throw invalido('talhão inexistente');

    const { rows: bases } = await poolOps().query<{ id: string; codigo: string; versao: string; data_corte: Date }>(
      `SELECT DISTINCT ON (codigo) id, codigo, versao, data_corte
         FROM ops.base_referencia_geo ORDER BY codigo, versao DESC`);

    const porBase: Array<Record<string, unknown>> = [];
    let areaTotal = 0;
    const chave = `TALHAO/${talhaoId}`;

    for (const b of bases) {
      const r = await comCusto(poolOps(),
        { etapa: 'EUDR_CRUZAMENTO', sujeitoTipo: 'TALHAO', sujeitoId: talhaoId,
          automatica: true, tarifaCentavos: 35, fonte: b.codigo },
        () => this.cruzarBase(talhaoId, b.id));

      const area = Number(r?.area_sobreposta_ha ?? 0);
      areaTotal = Math.max(areaTotal, area);
      const margemHa = Number(r?.margem_ha ?? 0);
      // Abaixo da margem, a sobreposição não distingue "desmatou" de "erro de
      // borda". Chamar isso de conforme é o falso conforme que contamina o
      // colateral e a DDS.
      const resultado = area === 0 ? 'CONFORME' : area <= margemHa ? 'LIMITROFE' : 'NAO_CONFORME';
      porBase.push({ codigo: b.codigo, versao: b.versao, resultado,
                     area_sobreposta_ha: Number(area.toFixed(4)),
                     margem_ha: Number(margemHa.toFixed(4)), resolucao_m: r?.resolucao_m ?? null });

      await fetch(`${URL_ORACLE}/sim/geo`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chave, fonte: b.codigo === 'MAPBIOMAS' ? 'MAPBIOMAS' : 'PRODES',
                               resultado: { resultado, area_sobreposta_ha: Number(area.toFixed(4)) } }),
      });
    }

    const leitura = await fetch(`${URL_ORACLE}/leituras/coletar`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'GEOESPACIAL', chave }),
    }).then((r) => r.json() as Promise<{ id: string; estado: string; valorJson: { resultado: string } }>);

    if (leitura.estado !== 'EFETIVA') {
      throw semQuorum('GEOESPACIAL', `quórum de bases não atingido (estado ${leitura.estado})`);
    }

    const resultado = leitura.valorJson.resultado as 'CONFORME' | 'NAO_CONFORME' | 'LIMITROFE' | 'INCONCLUSIVO';
    const insumos = { talhao_id: talhaoId, poligono_hash: '0x' + t[0].poligono_hash,
                      poligono_versao: t[0].poligono_versao, bases: porBase };
    const insumosHash = hashPayload(insumos);
    const hashEvidencia = hashPayload({ insumos, resultado, area_sobreposta_ha: areaTotal });

    return comCusto(poolOps(),
      { etapa: 'EUDR_EVIDENCIA', sujeitoTipo: 'TALHAO', sujeitoId: talhaoId, automatica: true },
      async () => emTransacao(poolOps(), async (cli) => {
        const { rows } = await cli.query<{ id: string }>(
          `INSERT INTO ops.evidencia_eudr
             (talhao_id, poligono_versao, poligono_hash, leitura_id, resultado, area_sobreposta_ha,
              margem_erro_m, bases, insumos_hash, hash_evidencia, evidencia_uri, valida_ate)
           VALUES ($1,$2, decode($3,'hex'), $4,$5,$6,$7,$8, decode($9,'hex'), decode($10,'hex'), $11,
                   now() + interval '180 days')
           RETURNING id`,
          [talhaoId, t[0].poligono_versao, t[0].poligono_hash, leitura.id, resultado,
           areaTotal.toFixed(4), 30, JSON.stringify(porBase), insumosHash.slice(2),
           hashEvidencia.slice(2), `evidencia://eudr/${hashEvidencia.slice(2, 18)}`]);

        await cli.query(
          'INSERT INTO ops.uso_leitura (leitura_id, decisao_tipo, decisao_id) VALUES ($1,$2,$3)',
          [leitura.id, 'SELO_EUDR', rows[0].id]);

        // O selo é atributo do colateral: propaga para os contratos do talhão.
        await cli.query(
          `UPDATE ops.contrato c SET selo_eudr = $2, selo_eudr_em = now()
            WHERE c.id IN (SELECT contrato_id FROM ops.contrato_talhao WHERE talhao_id = $1)`,
          [talhaoId, resultado]);

        await publicar(cli, ctx, {
          tipo: 'eudr.evidencia-gerada', sujeitoTipo: 'TALHAO', sujeitoId: talhaoId,
          payload: {
            evidencia_id: rows[0].id, talhao_id: talhaoId, poligono_hash: '0x' + t[0].poligono_hash,
            resultado, area_sobreposta_ha: Number(areaTotal.toFixed(4)),
            hash_evidencia: hashEvidencia, bases: porBase,
          },
          evidencia: [{ tipo: 'EVIDENCIA_EUDR', hash: hashEvidencia }],
        });
        log.info(ctx, 'evidência EUDR gerada', { talhao_id: talhaoId, resultado });
        return {
          id: rows[0].id, talhao_id: talhaoId, poligono_hash: '0x' + t[0].poligono_hash,
          resultado, area_sobreposta_ha: Number(areaTotal.toFixed(4)), margem_erro_m: 30,
          bases: porBase, leitura_id: leitura.id, hash_evidencia: hashEvidencia,
          valida_ate: new Date(Date.now() + 180 * 86400_000).toISOString(),
        };
      }));
  }

  async obter(evidenciaId: string) {
    const { rows } = await poolOps().query(
      `SELECT id, talhao_id, poligono_versao, encode(poligono_hash,'hex') AS poligono_hash,
              resultado, area_sobreposta_ha, margem_erro_m, bases, leitura_id,
              encode(hash_evidencia,'hex') AS hash_evidencia, evidencia_uri, gerada_em, valida_ate
         FROM ops.evidencia_eudr WHERE id = $1`, [evidenciaId]);
    if (!rows.length) return null;
    const r = rows[0];
    return { ...r, poligono_hash: '0x' + r.poligono_hash, hash_evidencia: '0x' + r.hash_evidencia };
  }

  /**
   * Reprodução (P6): reexecuta o cruzamento com os mesmos insumos e compara o
   * hash. Divergência aqui significa que a evidência não é reproduzível —
   * achado crítico, não curiosidade.
   */
  async reproduzir(evidenciaId: string) {
    const original = await this.obter(evidenciaId);
    if (!original) return null;

    const { rows: bases } = await poolOps().query<{ id: string; codigo: string }>(
      `SELECT DISTINCT ON (codigo) id, codigo FROM ops.base_referencia_geo ORDER BY codigo, versao DESC`);
    const porBase: Array<Record<string, unknown>> = [];
    let areaTotal = 0;
    for (const b of bases) {
      const r = await this.cruzarBase(original.talhao_id as string, b.id);
      const area = Number(r?.area_sobreposta_ha ?? 0);
      areaTotal = Math.max(areaTotal, area);
      const margemHa = Number(r?.margem_ha ?? 0);
      porBase.push({ codigo: r.base_codigo, versao: r.versao,
                     resultado: area === 0 ? 'CONFORME' : area <= margemHa ? 'LIMITROFE' : 'NAO_CONFORME',
                     area_sobreposta_ha: Number(area.toFixed(4)),
                     margem_ha: Number(margemHa.toFixed(4)), resolucao_m: r?.resolucao_m ?? null });
    }
    const insumos = { talhao_id: original.talhao_id, poligono_hash: original.poligono_hash,
                      poligono_versao: original.poligono_versao, bases: porBase };
    const reproduzido = hashPayload({ insumos, resultado: original.resultado, area_sobreposta_ha: areaTotal });

    const divergencias: string[] = [];
    if (reproduzido !== original.hash_evidencia) {
      divergencias.push(`hash divergente: original ${original.hash_evidencia}, reproduzido ${reproduzido}`);
    }
    return {
      reproduzivel: divergencias.length === 0,
      hash_original: original.hash_evidencia, hash_reproduzido: reproduzido, divergencias,
    };
  }

  /** Emite a DDS. Evidência não conforme, vencida ou de polígono antigo não emite. */
  async emitirDds(ctx: Contexto, contratoId: string, evidencias: string[], operadorRef: string) {
    for (const id of evidencias) {
      const e = await this.obter(id);
      if (!e) throw invalido(`evidência ${id} inexistente`);
      if (e.resultado !== 'CONFORME') {
        throw invalido(`evidência ${id} com resultado ${e.resultado}: DDS não é emitida sobre incerteza`);
      }
      if (new Date(e.valida_ate as string) < new Date()) throw invalido(`evidência ${id} vencida`);
      const { rows } = await poolOps().query<{ poligono_versao: number }>(
        'SELECT poligono_versao FROM ops.talhao WHERE id = $1', [e.talhao_id]);
      if (rows[0].poligono_versao !== e.poligono_versao) {
        throw invalido(`evidência ${id} é de versão anterior do polígono`);
      }
    }

    const numero = `DDS-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const hash = hashPayload({ contratoId, evidencias, numero });
    return comCusto(poolOps(),
      { etapa: 'DDS_EMISSAO', sujeitoTipo: 'CONTRATO', sujeitoId: contratoId, automatica: true, tarifaCentavos: 120 },
      async () => emTransacao(poolOps(), async (cli) => {
        const { rows } = await cli.query<{ id: string }>(
          `INSERT INTO ops.dds (contrato_id, numero, estado, evidencias, operador_ref, hash_dds, dds_uri, emitida_em)
           VALUES ($1,$2,'EMITIDA',$3,$4, decode($5,'hex'), $6, now()) RETURNING id`,
          [contratoId, numero, evidencias, Buffer.from(operadorRef, 'hex'),
           hash.slice(2), `dds://${numero}`]);
        await publicar(cli, ctx, {
          tipo: 'eudr.dds-emitida', sujeitoTipo: 'DDS', sujeitoId: rows[0].id,
          payload: { dds_id: rows[0].id, contrato_id: contratoId, numero, evidencias, hash_dds: hash },
          evidencia: evidencias.map((id) => ({ tipo: 'EVIDENCIA_EUDR', id, hash })),
        });
        log.info(ctx, 'DDS emitida', { numero, contrato_id: contratoId });
        return { id: rows[0].id, numero, estado: 'EMITIDA', contrato_id: contratoId, evidencias, hash_dds: hash };
      }));
  }

  /** Reavaliação contínua: o selo é atributo perecível do colateral. */
  async reavaliar(ctx: Contexto, talhaoId: string) {
    const { rows: anterior } = await poolOps().query(
      `SELECT id, resultado FROM ops.evidencia_eudr WHERE talhao_id = $1
        ORDER BY gerada_em DESC LIMIT 1`, [talhaoId]);
    const nova = await this.avaliar(ctx, talhaoId);
    const mudou = anterior.length ? anterior[0].resultado !== nova.resultado : false;

    await poolOps().query(
      `INSERT INTO ops.reavaliacao_eudr (talhao_id, evidencia_anterior, evidencia_nova, mudou_resultado, disparada_por)
       VALUES ($1,$2,$3,$4,'AGENDA')`,
      [talhaoId, anterior[0]?.id ?? null, nova.id, mudou]);

    if (mudou) {
      // A má notícia tem canal próprio desde SMC-004: antes, selo revogado não
      // gerava evento e o credor só descobriria olhando.
      const { rows: contratos } = await poolOps().query<{ contrato_id: string }>(
        'SELECT contrato_id FROM ops.contrato_talhao WHERE talhao_id = $1', [talhaoId]);
      await emTransacao(poolOps(), async (cli) => {
        await publicar(cli, ctx, {
          tipo: 'eudr.selo-revogado', sujeitoTipo: 'TALHAO', sujeitoId: talhaoId,
          payload: {
            talhao_id: talhaoId, evidencia_anterior: anterior[0]?.id ?? nova.id, evidencia_nova: nova.id,
            resultado_anterior: anterior[0]?.resultado ?? 'INCONCLUSIVO', resultado_novo: nova.resultado,
            contratos_afetados: contratos.map((c) => c.contrato_id),
          },
          evidencia: [{ tipo: 'EVIDENCIA_EUDR', id: nova.id, hash: nova.hash_evidencia }],
        });
      });
      log.aviso(ctx, 'selo EUDR mudou de resultado', { talhao_id: talhaoId, de: anterior[0]?.resultado, para: nova.resultado });
    }
    return { talhao_id: talhaoId, mudou_resultado: mudou, resultado: nova.resultado, evidencia_id: nova.id };
  }
}
