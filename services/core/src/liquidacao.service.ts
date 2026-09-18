import { Injectable } from '@nestjs/common';
import { poolOps, emTransacao, publicar, Contexto, log, congelado, semQuorum, ProblemaCpr, chamar, chamarJson } from '@cpr/nucleo';
import { Cadeia, hashDe } from '@cpr/nucleo';

const URL_ORACLE = process.env.URL_ORACLE ?? 'http://127.0.0.1:3002';

/**
 * Liquidação (F8). A plataforma **não recebe, não custodia e não repassa**
 * recursos: ela concilia o pagamento que ocorreu entre as partes e registra a
 * baixa. Conciliar é tudo o que ela faz, e é isso que a mantém fora do
 * perímetro de PSAV e de contraparte central (P7, ADR-0005).
 */
@Injectable()
export class LiquidacaoService {
  private cadeia: Cadeia | null = null;
  private get chain(): Cadeia { return (this.cadeia ??= new Cadeia()); }

  async liquidar(ctx: Contexto, contratoId: string, baixaRegistroRef: string) {
    const { rows } = await poolOps().query('SELECT * FROM ops.contrato WHERE id = $1', [contratoId]);
    if (!rows.length) throw new Error('contrato inexistente');
    const c = rows[0];
    if (c.situacao_conciliacao === 'CONGELADO') throw congelado(contratoId);

    // Pagamento exige unanimidade de duas fontes independentes: é fato binário,
    // e duas fontes que discordam significam que não se sabe (ADR-0003).
    const chave = `${c.registro_entidade}/${c.registro_id}`;
    const coleta = await chamarJson<{ id: string; estado: string; valorJson: { confirmado: boolean } }>(
      `${URL_ORACLE}/leituras/coletar`,
      { servico: 'services/core', metodo: 'POST', correlacaoId: ctx.correlacaoId,
        corpo: { tipo: 'PAGAMENTO', chave } });

    if (coleta.estado !== 'EFETIVA' || !coleta.valorJson?.confirmado) {
      throw semQuorum('PAGAMENTO', `pagamento não confirmado por quórum (estado ${coleta.estado})`);
    }

    const espelho = this.chain.espelho();
    const tx = await espelho.baixar(BigInt(c.token_id), hashDe(baixaRegistroRef));
    const recibo = await tx.wait();

    return emTransacao(poolOps(), async (cli) => {
      await cli.query(
        'INSERT INTO ops.uso_leitura (leitura_id, decisao_tipo, decisao_id) VALUES ($1,$2,$3)',
        [coleta.id, 'LIQUIDACAO', contratoId]);
      await cli.query(
        `INSERT INTO ops.contrato_transicao (contrato_id, de, para, guarda, origem, ator_tipo, evidencia)
         VALUES ($1,$2,'LIQUIDADO','pagamento_conciliado_e_baixa_no_registro',$3,'SERVICO',$4)`,
        [contratoId, c.estado, ctx.origem,
         JSON.stringify([{ tipo: 'TRANSACAO', hash: recibo.hash }, { tipo: 'LEITURA_ORACULO', id: coleta.id, hash: '0x' + '0'.repeat(64) }])]);
      await cli.query(
        "UPDATE ops.contrato SET estado='LIQUIDADO', atualizado_em=now() WHERE id=$1", [contratoId]);
      await publicar(cli, ctx, {
        tipo: 'contrato.liquidado', sujeitoTipo: 'CONTRATO', sujeitoId: contratoId,
        payload: {
          contrato_id: contratoId, leitura_pagamento_id: coleta.id,
          baixa_registro_ref: baixaRegistroRef, tx_baixa: recibo.hash,
        },
        evidencia: [{ tipo: 'TRANSACAO', hash: recibo.hash }],
      });
      log.info(ctx, 'contrato liquidado', { contrato_id: contratoId, tx: recibo.hash });
      return { contrato_id: contratoId, estado: 'LIQUIDADO', tx_baixa: recibo.hash };
    });
  }

  /** Inadimplência: gatilho por vencimento ou por LTV, sempre com leitura. */
  async marcarInadimplente(ctx: Contexto, contratoId: string, gatilho: string, leituras: string[] = []) {
    return emTransacao(poolOps(), async (cli) => {
      const { rows } = await cli.query<{ estado: string }>(
        'SELECT estado FROM ops.contrato WHERE id = $1', [contratoId]);
      const de = rows[0].estado;
      const guarda = de === 'EM_DISPUTA' ? 'disputa_resolvida_contra_devedor' : 'vencido_sem_liquidacao';
      await cli.query(
        `INSERT INTO ops.contrato_transicao (contrato_id, de, para, guarda, origem, ator_tipo, evidencia)
         VALUES ($1,$2,'INADIMPLENTE',$3,$4,'SERVICO',$5)`,
        [contratoId, de, guarda, ctx.origem,
         JSON.stringify(leituras.map((id) => ({ tipo: 'LEITURA_ORACULO', id, hash: '0x' + '0'.repeat(64) })))]);
      await cli.query("UPDATE ops.contrato SET estado='INADIMPLENTE' WHERE id=$1", [contratoId]);
      await cli.query(
        'INSERT INTO ops.evento_inadimplencia (contrato_id, gatilho, leituras) VALUES ($1,$2,$3)',
        [contratoId, gatilho, leituras]);
      await publicar(cli, ctx, {
        tipo: 'contrato.transicionado', sujeitoTipo: 'CONTRATO', sujeitoId: contratoId,
        payload: { contrato_id: contratoId, de, para: 'INADIMPLENTE', guarda },
        evidencia: [{ tipo: 'DOCUMENTO', hash: '0x' + '0'.repeat(64) }],
      });
      log.aviso(ctx, 'contrato inadimplente', { contrato_id: contratoId, gatilho });
      return { contrato_id: contratoId, estado: 'INADIMPLENTE', gatilho };
    });
  }
}
