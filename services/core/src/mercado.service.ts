import { Injectable } from '@nestjs/common';
import { poolOps, emTransacao, publicar, Contexto, log, semQuorum, ProblemaCpr } from '@cpr/nucleo';

const URL_ORACLE = process.env.URL_ORACLE ?? 'http://127.0.0.1:3002';

/**
 * Marcação a mercado (F5). O haircut é do modelo de risco, não do preço: o
 * preço vem do oráculo com quórum e o deságio reflete liquidez e prazo.
 *
 * A queda de preço reduz a receita do produtor e o valor do colateral ao mesmo
 * tempo. O LTV precisa responder aos dois — é a pró-ciclicidade que E4 cobra.
 */
@Injectable()
export class MercadoService {
  async marcar(ctx: Contexto, contratoId: string, haircutPct = 20) {
    const { rows } = await poolOps().query(
      'SELECT id, quantidade_sacas, valor_face, commodity FROM ops.contrato WHERE id = $1', [contratoId]);
    if (!rows.length) throw new Error('contrato inexistente');
    const c = rows[0];

    const r = await fetch(`${URL_ORACLE}/leituras/efetiva?tipo=PRECO&chave=${c.commodity}/BRL-SACA`);
    if (!r.ok) throw semQuorum('PRECO', 'sem leitura vigente para marcação a mercado');
    const leitura = await r.json() as {
      id: string; valor_numerico: string; idade_segundos: number;
      coleta_corrente_sem_quorum: boolean; aviso: string | null;
    };

    const preco = Number(leitura.valor_numerico);
    const bruto = preco * Number(c.quantidade_sacas);
    const mtm = bruto * (1 - haircutPct / 100);
    const ltv = (Number(c.valor_face) / mtm) * 100;

    await emTransacao(poolOps(), async (cli) => {
      const { rows: m } = await cli.query<{ id: string }>(
        `INSERT INTO ops.marcacao_mercado (contrato_id, leitura_id, preco_saca, haircut_pct, valor_mtm, ltv_pct)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [contratoId, leitura.id, preco.toFixed(2), haircutPct, mtm.toFixed(2), Math.min(ltv, 9999).toFixed(4)]);
      // A leitura consumida fica amarrada à decisão: sem isso, "de onde veio
      // este número" não tem resposta (P5) — e o gatilho do banco recusa
      // leitura fora do quórum (SMC-002).
      await cli.query(
        'INSERT INTO ops.uso_leitura (leitura_id, decisao_tipo, decisao_id) VALUES ($1,$2,$3)',
        [leitura.id, 'MTM', m[0]?.id ?? contratoId]);
      await cli.query(
        'UPDATE ops.contrato SET valor_mtm = $2, valor_mtm_em = now() WHERE id = $1',
        [contratoId, mtm.toFixed(2)]);
      await publicar(cli, ctx, {
        tipo: 'mercado.marcacao-atualizada', sujeitoTipo: 'CONTRATO', sujeitoId: contratoId,
        payload: {
          contrato_id: contratoId, leitura_id: leitura.id, preco_saca: preco.toFixed(2),
          haircut_pct: haircutPct, valor_mtm: mtm.toFixed(2), ltv_pct: Number(Math.min(ltv, 9999).toFixed(2)),
        },
        evidencia: [{ tipo: 'LEITURA_ORACULO', id: leitura.id, hash: '0x' + '0'.repeat(64) }],
      });
    });

    if (leitura.coleta_corrente_sem_quorum) {
      log.aviso(ctx, 'MTM calculada sobre leitura dentro da janela, mas sem quórum corrente', {
        contrato_id: contratoId, idade_segundos: leitura.idade_segundos,
      });
    }
    return {
      contrato_id: contratoId, preco_saca: preco.toFixed(2), valor_mtm: mtm.toFixed(2),
      ltv_pct: Number(ltv.toFixed(2)), haircut_pct: haircutPct,
      frescor_segundos: leitura.idade_segundos, aviso: leitura.aviso,
    };
  }
}
