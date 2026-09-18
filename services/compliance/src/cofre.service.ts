import { Injectable } from '@nestjs/common';
import { poolPii, poolOps, emTransacao, novaRefOpaca, hmacDocumento, sha256Hex,
         Contexto, log, registrarCusto, comCusto } from '@cpr/nucleo';
import { KmsLocal } from './kms';
import { consultarListas, verificarCar, Restricao } from './listas';

export interface EntradaOnboarding {
  tipo_pessoa: 'PF' | 'PJ';
  documento: string;
  nome: string;
  nascimento?: string;
  contato?: string;
  car_numero?: string;
  base_legal: 'CONTRATO' | 'OBRIGACAO_LEGAL' | 'CONSENTIMENTO' | 'LEGITIMO_INTERESSE';
  porte?: 'PEQUENO' | 'MEDIO' | 'GRANDE';
  uf?: string;
  municipio_ibge?: string;
  restricao_simulada?: Restricao | null;
}

@Injectable()
export class CofreService {
  private readonly kms = new KmsLocal();
  private readonly chaveIndice = process.env.CHAVE_INDICE_CEGO ?? 'dev';

  /**
   * Única rota do sistema que aceita dado identificável. O que sai daqui é
   * referência opaca; o dado entra cifrado no cofre e não trafega de novo.
   */
  async onboarding(ctx: Contexto, e: EntradaOnboarding) {
    const documentoHmac = hmacDocumento(e.documento, this.chaveIndice);

    // Idempotência por documento: reonboarding não cria segundo titular.
    const existente = await poolPii().query<{ id: string; ops_produtor_id: string }>(
      'SELECT id, ops_produtor_id FROM pii.titular WHERE documento_hmac = $1', [documentoHmac]);
    if (existente.rowCount) {
      const p = await poolOps().query<{ ref_opaca: Buffer; situacao_kyc: string }>(
        'SELECT ref_opaca, situacao_kyc FROM ops.produtor WHERE id = $1', [existente.rows[0].ops_produtor_id]);
      return { produtor_ref: p.rows[0].ref_opaca.toString('hex'), situacao: p.rows[0].situacao_kyc };
    }

    const kmsRef = this.kms.criarChave();
    const refOpaca = novaRefOpaca();                       // aleatória, nunca derivada do documento
    const produtorId = crypto.randomUUID();
    const titularId = crypto.randomUUID();

    const cifrar = (v?: string) => (v ? this.kms.cifrar(kmsRef, v) : null);

    await emTransacao(poolPii(), async (c) => {
      await c.query(
        'INSERT INTO pii.chave_titular (titular_id, kms_key_ref) VALUES ($1,$2)', [titularId, kmsRef]);
      await c.query(
        `INSERT INTO pii.titular (id, ops_produtor_id, tipo_pessoa, nome_cif, documento_cif,
                                  nascimento_cif, contato_cif, car_numero_cif, documento_hmac)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [titularId, produtorId, e.tipo_pessoa, cifrar(e.nome), cifrar(e.documento),
         cifrar(e.nascimento), cifrar(e.contato), cifrar(e.car_numero), documentoHmac]);
      await this.registrarTratamento(c, titularId, 'COLETA', e.base_legal,
        ['nome', 'documento', 'nascimento', 'contato', 'car_numero'],
        'onboarding de produtor', ctx.origem);
    });

    await poolOps().query(
      `INSERT INTO ops.produtor (id, ref_opaca, pii_ref, tipo_pessoa, porte, uf, municipio_ibge, situacao_kyc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'EM_ANALISE')`,
      [produtorId, Buffer.from(refOpaca, 'hex'), titularId, e.tipo_pessoa,
       e.porte ?? 'PEQUENO', e.uf ?? 'MG', e.municipio_ibge ?? '3100000']);

    log.info(ctx, 'onboarding aceito', { produtor_ref: refOpaca });
    return { produtor_ref: refOpaca, situacao: 'EM_ANALISE' as const, _interno: { produtorId, titularId, kmsRef, entrada: e } };
  }

  /** Executa KYC. Todo custo é medido na etapa em que ocorre (SMC-007). */
  async executarKyc(ctx: Contexto, produtorId: string, titularId: string, e: EntradaOnboarding) {
    const listas = await comCusto(poolOps(),
      { etapa: 'KYC_LISTAS', sujeitoTipo: 'PRODUTOR', sujeitoId: produtorId, automatica: true,
        tarifaCentavos: 440, fonte: 'listas-restritivas' },
      async () => consultarListas(e.documento, e.restricao_simulada));

    const car = e.car_numero
      ? await comCusto(poolOps(),
          { etapa: 'CAR_SICAR', sujeitoTipo: 'PRODUTOR', sujeitoId: produtorId, automatica: true,
            tarifaCentavos: 60, fonte: 'SICAR' },
          async () => verificarCar(e.car_numero!))
      : { valido: true, evidenciaHash: '0x' + '0'.repeat(64) };

    const restricoes: Restricao[] = [...listas.restricoes];
    if (!car.valido) restricoes.push('CAR_INVALIDO');

    // Documento exige leitura humana quando há restrição: a decisão de recusar
    // alguém não é automatizável sem revisão, e o esforço entra no custo real.
    if (restricoes.length > 0) {
      await registrarCusto(poolOps(), {
        etapa: 'ANALISE_HUMANA', sujeitoTipo: 'PRODUTOR', sujeitoId: produtorId,
        automatica: false, esforcoHumanoSeg: 900, duracaoMs: 900_000, sucesso: true,
      });
    }

    const aprovado = restricoes.length === 0;
    const validoAte = new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10);

    await poolPii().query(
      `INSERT INTO pii.resultado_kyc (titular_id, provedor, listas_consultadas, resultado,
                                      evidencia_uri, evidencia_hash, valido_ate)
       VALUES ($1,$2,$3,$4,$5,decode($6,'hex'),$7)`,
      [titularId, 'simulador', listas.listasConsultadas, aprovado ? 'APROVADO' : 'REPROVADO',
       `evidencia://kyc/${produtorId}`, listas.evidenciaHash.slice(2), validoAte]);

    await poolOps().query(
      `UPDATE ops.produtor SET situacao_kyc = $2, kyc_valido_ate = $3, atualizado_em = now()
        WHERE id = $1`,
      [produtorId, aprovado ? 'APROVADO' : 'REPROVADO', aprovado ? validoAte : null]);

    log.info(ctx, 'kyc concluído', { produtor_id: produtorId, aprovado, restricoes });
    return { aprovado, restricoes, validoAte };
  }

  /** Atestação: devolve o fato, nunca o dossiê que o sustenta. */
  async situacao(refOpaca: string) {
    const { rows } = await poolOps().query(
      `SELECT id, situacao_kyc, kyc_valido_ate, porte, uf, municipio_ibge, did, eliminado_em
         FROM ops.produtor WHERE ref_opaca = $1`, [Buffer.from(refOpaca, 'hex')]);
    if (!rows.length) return null;
    const p = rows[0];
    const expirado = p.kyc_valido_ate && new Date(p.kyc_valido_ate) < new Date();
    return {
      produtor_ref: refOpaca,
      situacao: expirado ? 'EXPIRADO' : p.situacao_kyc,
      valido_ate: p.kyc_valido_ate,
      habilitado_a_originar: p.situacao_kyc === 'APROVADO' && !expirado && !p.eliminado_em,
      restricoes: [] as string[],
      porte: p.porte, uf: p.uf, municipio_ibge: p.municipio_ibge,
      did: p.did,
    };
  }

  async registrarTratamento(
    c: { query: (q: string, v: unknown[]) => Promise<unknown> },
    titularId: string, operacao: string, baseLegal: string,
    campos: string[], finalidade: string, solicitante: string, destinatario?: string,
  ) {
    await c.query(
      `INSERT INTO pii.operacao_tratamento
         (titular_id, finalidade, base_legal, campos, operacao, destinatario, solicitante, justificativa)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [titularId, finalidade, baseLegal, campos, operacao, destinatario ?? null, solicitante,
       'registro obrigatório de operação de tratamento']);
  }

  kmsRefDoTitular = async (titularId: string): Promise<string> => {
    const { rows } = await poolPii().query<{ kms_key_ref: string }>(
      'SELECT kms_key_ref FROM pii.chave_titular WHERE titular_id = $1', [titularId]);
    if (!rows.length) throw new Error('titular sem chave');
    return rows[0].kms_key_ref;
  };

  get kmsLocal(): KmsLocal { return this.kms; }
}
