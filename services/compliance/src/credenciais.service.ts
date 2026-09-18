import { Injectable } from '@nestjs/common';
import { createSign, createVerify, generateKeyPairSync, createHash } from 'node:crypto';
import { poolPii, poolOps, sha256Hex, canonico, Contexto, log } from '@cpr/nucleo';

/**
 * Credenciais verificáveis (W3C). Servem ao que E1 apontou em G1: sem
 * atestação de qualificação do detentor, a circulação do espelho perde uma das
 * pernas da defesa do ADR-0005.
 *
 * A VC completa vai ao titular; a terceiros vai o metadado e a verificação.
 */
@Injectable()
export class CredenciaisService {
  private readonly par = generateKeyPairSync('ed25519');
  readonly didEmissor = 'did:web:cpr.digital';

  private assinar(payload: unknown): string {
    const s = createSign('sha512');   // ed25519 ignora o digest informado
    return Buffer.from(
      require('node:crypto').sign(null, Buffer.from(canonico(payload)), this.par.privateKey),
    ).toString('base64url');
  }

  verificar(vc: { payload: unknown; assinatura: string; emissor: string }) {
    try {
      const ok = require('node:crypto').verify(
        null, Buffer.from(canonico(vc.payload)),
        this.par.publicKey, Buffer.from(vc.assinatura, 'base64url'));
      const p = vc.payload as { expira_em?: string };
      const expirada = p.expira_em ? new Date(p.expira_em) < new Date() : false;
      return { valida: ok && !expirada, revogada: false, expirada, emissor: vc.emissor };
    } catch {
      return { valida: false, revogada: false, expirada: false, emissor: vc.emissor };
    }
  }

  async emitir(ctx: Contexto, refOpaca: string, tipo: string, expiraEm?: string) {
    const { rows } = await poolOps().query<{ id: string; pii_ref: string; situacao_kyc: string }>(
      'SELECT id, pii_ref, situacao_kyc FROM ops.produtor WHERE ref_opaca = $1',
      [Buffer.from(refOpaca, 'hex')]);
    if (!rows.length) return null;
    if (rows[0].situacao_kyc !== 'APROVADO') {
      throw new Error('credencial só é emitida sobre KYC aprovado');
    }

    const didSujeito = `did:key:${refOpaca}`;
    const expira = expiraEm ?? new Date(Date.now() + 365 * 86400_000).toISOString();
    // O payload da VC não carrega dado identificável: carrega a atestação.
    const payload = {
      tipo, emissor: this.didEmissor, sujeito: didSujeito,
      emitida_em: new Date().toISOString(), expira_em: expira,
      atestacao: { kyc: 'APROVADO' },
    };
    const vc = { payload, assinatura: this.assinar(payload), emissor: this.didEmissor };
    const vcHash = sha256Hex(canonico(vc));

    const kmsRef = await poolPii().query<{ kms_key_ref: string }>(
      'SELECT kms_key_ref FROM pii.chave_titular WHERE titular_id = $1', [rows[0].pii_ref]);

    await poolPii().query(
      `INSERT INTO pii.credencial_verificavel
         (titular_id, tipo, did_emissor, did_sujeito, vc_cif, vc_hash, expira_em)
       VALUES ($1,$2,$3,$4,$5,decode($6,'hex'),$7)`,
      [rows[0].pii_ref, tipo, this.didEmissor, didSujeito,
       Buffer.from(JSON.stringify(vc)), vcHash.slice(2), expira]);

    await poolOps().query('UPDATE ops.produtor SET did = $2 WHERE id = $1', [rows[0].id, didSujeito]);
    log.info(ctx, 'credencial emitida', { produtor_ref: refOpaca, tipo });
    return { tipo, did_emissor: this.didEmissor, did_sujeito: didSujeito, vc_hash: vcHash, expira_em: expira, vc };
  }

  async listar(refOpaca: string) {
    const { rows } = await poolOps().query<{ pii_ref: string }>(
      'SELECT pii_ref FROM ops.produtor WHERE ref_opaca = $1', [Buffer.from(refOpaca, 'hex')]);
    if (!rows.length) return [];
    const { rows: cs } = await poolPii().query(
      `SELECT id, tipo, did_emissor, did_sujeito, encode(vc_hash,'hex') AS vc_hash,
              emitida_em, expira_em, revogada_em IS NOT NULL AS revogada
         FROM pii.credencial_verificavel WHERE titular_id = $1 ORDER BY emitida_em DESC`,
      [rows[0].pii_ref]);
    return cs.map((c: Record<string, unknown>) => ({ ...c, vc_hash: '0x' + c.vc_hash }));
  }
}
