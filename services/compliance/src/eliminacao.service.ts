import { Injectable } from '@nestjs/common';
import { poolPii, poolOps, emTransacao, Contexto, log } from '@cpr/nucleo';
import { CofreService } from './cofre.service';

/**
 * Direito de eliminação (LGPD). A eliminação honesta diz o que **não**
 * eliminou: registros sob obrigação legal permanecem, pseudonimizados, e o
 * pedido documenta o que ficou e sob que fundamento.
 */
@Injectable()
export class EliminacaoService {
  constructor(private readonly cofre: CofreService) {}

  private retencaoObrigatoria(temContrato: boolean) {
    if (!temContrato) return [];
    return [{
      categoria: 'REGISTROS_CONTRATUAIS',
      fundamento: 'LGPD art. 16, I — cumprimento de obrigação legal ou regulatória',
      ate: new Date(Date.now() + 5 * 365 * 86400_000).toISOString().slice(0, 10),
    }];
  }

  async eliminar(ctx: Contexto, refOpaca: string, canal: string, solicitante: string) {
    const { rows } = await poolOps().query<{ id: string; pii_ref: string }>(
      'SELECT id, pii_ref FROM ops.produtor WHERE ref_opaca = $1', [Buffer.from(refOpaca, 'hex')]);
    if (!rows.length) return null;
    const { id: produtorId, pii_ref: titularId } = rows[0];

    const contratos = await poolOps().query(
      "SELECT 1 FROM ops.contrato WHERE produtor_id = $1 AND estado <> 'RASCUNHO' LIMIT 1", [produtorId]);
    const retencao = this.retencaoObrigatoria((contratos.rowCount ?? 0) > 0);

    const kmsRef = await this.cofre.kmsRefDoTitular(titularId);
    const comprovante = this.cofre.kmsLocal.destruir(kmsRef);
    const destruidaEm = new Date();

    // Verificação de irreversibilidade: tentar decifrar e exigir a falha. É a
    // evidência que a Seção 12 do briefing pede, e não vale afirmar sem tentar.
    let verificacao: 'FALHOU_COMO_ESPERADO' | 'SUCESSO_INESPERADO' = 'SUCESSO_INESPERADO';
    try {
      const { rows: r } = await poolPii().query<{ nome_cif: Buffer }>(
        'SELECT nome_cif FROM pii.titular WHERE id = $1', [titularId]);
      this.cofre.kmsLocal.decifrar(kmsRef, r[0].nome_cif);
    } catch {
      verificacao = 'FALHOU_COMO_ESPERADO';
    }

    const estado = retencao.length ? 'PARCIAL' : 'CONCLUIDO';
    await emTransacao(poolPii(), async (c) => {
      await c.query(
        'UPDATE pii.chave_titular SET destruida_em = $2, destruicao_ref = $3 WHERE titular_id = $1',
        [titularId, destruidaEm, comprovante]);
      await c.query('UPDATE pii.titular SET eliminado_em = $2 WHERE id = $1', [titularId, destruidaEm]);
      await c.query(
        `INSERT INTO pii.pedido_eliminacao
           (titular_id, canal, estado, retencao_obrigatoria, chave_destruida_em, comprovante_kms,
            verificacao_irreversibilidade, concluido_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
        [titularId, canal, estado, JSON.stringify(retencao), destruidaEm, comprovante,
         JSON.stringify({ tentativa_decifragem: verificacao, verificada_em: new Date().toISOString() })]);
      await this.cofre.registrarTratamento(c, titularId, 'ELIMINACAO', 'OBRIGACAO_LEGAL',
        ['todos'], 'pedido de eliminação do titular', solicitante);
    });

    // O produtor permanece em ops, sem PII e sem possibilidade de
    // reidentificação: o histórico contratual é obrigação legal; o que
    // desaparece é a capacidade de ligar o pseudônimo a uma pessoa.
    await poolOps().query(
      "UPDATE ops.produtor SET situacao_kyc = 'ELIMINADO', eliminado_em = $2 WHERE id = $1",
      [produtorId, destruidaEm]);

    log.info(ctx, 'eliminação executada', { produtor_ref: refOpaca, estado, verificacao });
    return {
      titular_ref: refOpaca,
      estado,
      chave_destruida_em: destruidaEm.toISOString(),
      comprovante_kms: comprovante,
      verificacao_irreversibilidade: { tentativa_decifragem: verificacao, verificada_em: new Date().toISOString() },
      retencao_obrigatoria: retencao,
    };
  }

  async comprovante(refOpaca: string) {
    const { rows } = await poolOps().query<{ pii_ref: string }>(
      'SELECT pii_ref FROM ops.produtor WHERE ref_opaca = $1', [Buffer.from(refOpaca, 'hex')]);
    if (!rows.length) return null;
    const { rows: p } = await poolPii().query(
      `SELECT estado, chave_destruida_em, comprovante_kms, verificacao_irreversibilidade, retencao_obrigatoria
         FROM pii.pedido_eliminacao WHERE titular_id = $1 ORDER BY solicitado_em DESC LIMIT 1`,
      [rows[0].pii_ref]);
    if (!p.length) return null;
    return { titular_ref: refOpaca, ...p[0] };
  }
}
