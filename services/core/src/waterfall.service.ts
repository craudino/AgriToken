import { Injectable } from '@nestjs/common';
import { poolOps, emTransacao, hashPayload, Contexto, log } from '@cpr/nucleo';

interface Cenario {
  cenario: 'INADIMPLENCIA_ISOLADA' | 'QUEBRA_SISTEMICA' | 'QUEDA_PRECO_EXCUSSAO';
  politica_id: string;
  semente: number;
  contratos?: string[];
  parametros?: { choque_preco_pct?: number; quebra_produtividade_pct?: number; taxa_inadimplencia_pct?: number };
}

/**
 * Simulação do waterfall (W8). Determinística por semente (P6): mesma entrada,
 * mesmo hash de resultado.
 *
 * Duas escolhas que E4 vai cobrar, e que estão explícitas no cálculo:
 *
 * 1. O seguro agrícola cobre quebra de produtividade, **não** queda de preço.
 *    Tratá-lo como colchão genérico é o erro que faz o fundo parecer suficiente
 *    no papel e insuficiente na safra ruim.
 * 2. Garantia real não averbada não absorve nada. Sem oponibilidade, o que
 *    existe é expectativa de recuperação, não colateral (SMC-006).
 */
@Injectable()
export class WaterfallService {
  async simular(ctx: Contexto, e: Cenario) {
    const { rows: niveis } = await poolOps().query(
      `SELECT nivel, rotulo, cap_pct_exposicao, haircut_pct, prazo_recuperacao_dias
         FROM ops.waterfall_nivel WHERE politica_id = $1 ORDER BY nivel`, [e.politica_id]);
    if (!niveis.length) throw new Error('política de waterfall inexistente');

    const { rows: contratos } = await poolOps().query(
      `SELECT c.id, c.valor_face, c.valor_mtm, c.quantidade_sacas
         FROM ops.contrato c
        WHERE ($1::uuid[] IS NULL OR c.id = ANY($1)) AND c.token_id IS NOT NULL`,
      [e.contratos?.length ? e.contratos : null]);

    const p = e.parametros ?? {};
    const choque = (p.choque_preco_pct ?? 0) / 100;
    const quebra = (p.quebra_produtividade_pct ?? 0) / 100;
    const inadimplencia = (p.taxa_inadimplencia_pct ?? 0) / 100;

    const exposicao = contratos.reduce((s, c) => s + Number(c.valor_face), 0);
    // A perda combina inadimplência com o efeito do choque sobre o colateral:
    // em quebra sistêmica, receita e garantia caem juntas.
    const perdaBruta = exposicao * inadimplencia * (1 + Math.abs(choque) + Math.abs(quebra));

    const { rows: garantias } = await poolOps().query(
      `SELECT nivel_waterfall, tipo, sum(valor_declarado) AS valor,
              bool_or(oponibilidade = 'AVERBADA') AS tem_oponivel,
              sum(CASE WHEN oponibilidade = 'AVERBADA' THEN valor_declarado ELSE 0 END) AS valor_oponivel
         FROM ops.garantia
        WHERE liberada_em IS NULL AND ($1::uuid[] IS NULL OR contrato_id = ANY($1))
        GROUP BY nivel_waterfall, tipo`,
      [e.contratos?.length ? e.contratos : null]);

    let residual = perdaBruta;
    const resultados: Array<Record<string, unknown>> = [];

    for (const n of niveis) {
      const doNivel = garantias.filter((g) => g.nivel_waterfall === n.nivel);
      let disponivel = 0;
      for (const g of doNivel) {
        const real = ['PENHOR_SAFRA', 'ALIENACAO_FIDUCIARIA_IMOVEL', 'ALIENACAO_FIDUCIARIA_MAQUINA', 'HIPOTECA']
          .includes(g.tipo);
        // Só o que é oponível conta como colateral real.
        const base = real ? Number(g.valor_oponivel) : Number(g.valor);
        let efetivo = base * (1 - Number(n.haircut_pct) / 100);
        if (g.tipo === 'SEGURO_AGRICOLA') {
          // Seguro responde a quebra de produtividade, não a preço.
          efetivo = quebra > 0 ? efetivo : 0;
        }
        disponivel += efetivo;
      }
      const teto = exposicao * (Number(n.cap_pct_exposicao) / 100);
      disponivel = Math.min(disponivel, teto);
      const absorvido = Math.min(disponivel, residual);
      residual -= absorvido;

      // O prazo p90 cresce com o estresse: em evento sistêmico, todos executam
      // ao mesmo tempo e a fila é mais longa.
      const fator = 1 + Math.abs(choque) + inadimplencia * 2;
      resultados.push({
        nivel: n.nivel, rotulo: n.rotulo,
        absorvido: absorvido.toFixed(2),
        esgotado: disponivel > 0 && absorvido >= disponivel - 0.005,
        recuperacao_dias_p50: Math.round(Number(n.prazo_recuperacao_dias)),
        recuperacao_dias_p90: Math.round(Number(n.prazo_recuperacao_dias) * fator * 1.6),
        observacao: doNivel.some((g) => g.tipo === 'SEGURO_AGRICOLA') && quebra === 0
          ? 'seguro não acionado: o evento é de preço, não de produtividade'
          : null,
      });
    }

    const hash = hashPayload({ cenario: e.cenario, politica: e.politica_id, semente: e.semente,
                               parametros: p, resultados, exposicao, perdaBruta, residual });

    const id = await emTransacao(poolOps(), async (cli) => {
      const { rows } = await cli.query<{ id: string }>(
        `INSERT INTO ops.simulacao_waterfall
           (politica_id, cenario, parametros, semente, escopo_contratos, exposicao_total,
            perda_bruta, perda_residual, hash_resultado, executada_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, decode($9,'hex'), $10) RETURNING id`,
        [e.politica_id, e.cenario, JSON.stringify(p), e.semente, contratos.map((c) => c.id),
         exposicao.toFixed(2), perdaBruta.toFixed(2), residual.toFixed(2), hash.slice(2), ctx.origem]);
      for (const r of resultados) {
        await cli.query(
          `INSERT INTO ops.simulacao_nivel_resultado
             (simulacao_id, nivel, absorvido, esgotado, recuperacao_dias_p50, recuperacao_dias_p90, observacao)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [rows[0].id, r.nivel, r.absorvido, r.esgotado, r.recuperacao_dias_p50, r.recuperacao_dias_p90, r.observacao]);
      }
      return rows[0].id;
    });

    log.info(ctx, 'waterfall simulado', { cenario: e.cenario, exposicao, perda_residual: residual });
    return {
      id, hash_resultado: hash, cenario: e.cenario,
      contratos: contratos.length,
      exposicao_total: { valor: exposicao.toFixed(2), moeda: 'BRL' },
      perda_bruta: { valor: perdaBruta.toFixed(2), moeda: 'BRL' },
      perda_residual: { valor: residual.toFixed(2), moeda: 'BRL' },
      niveis: resultados,
    };
  }
}
