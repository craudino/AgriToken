import { Body, Controller, Get, Headers, HttpException, Param, Post, Query } from '@nestjs/common';
import { poolPii, poolOps, versaoServico, Contexto, log } from '@cpr/nucleo';
import { Cadeia, sha256Hex } from '@cpr/nucleo';
import { CofreService, EntradaOnboarding } from './cofre.service';
import { EliminacaoService } from './eliminacao.service';
import { CredenciaisService } from './credenciais.service';

const ctxDe = (correlacao?: string): Contexto => ({
  correlacaoId: correlacao ?? crypto.randomUUID(),
  origem: versaoServico('services/compliance'),
});

@Controller()
export class AppController {
  constructor(
    private readonly cofre: CofreService,
    private readonly eliminacao: EliminacaoService,
    private readonly credenciais: CredenciaisService,
  ) {}

  private cadeia: Cadeia | null = null;
  private get chain(): Cadeia { return (this.cadeia ??= new Cadeia()); }

  @Get('/saude')
  saude() { return { servico: 'compliance', ok: true }; }

  /**
   * Habilita um participante na cadeia. É a perna do ADR-0005 que fecha a
   * circulação: o espelho não vai para endereço que a plataforma não habilitou,
   * e a habilitação exige KYC aprovado e vigente — nunca é um cadastro à parte.
   *
   * O que sobe para a cadeia é o hash da atestação e a validade. Nome,
   * documento e dossiê ficam onde estão (P2).
   */
  @Post('/participantes/habilitar')
  async habilitar(
    @Headers('x-correlacao-id') cid: string,
    @Body() corpo: { produtor_ref: string; endereco: string },
  ) {
    const s = await this.cofre.situacao(corpo.produtor_ref);
    if (!s) throw new HttpException({ title: 'Produtor não encontrado', status: 404 }, 404);
    if (!s.habilitado_a_originar) {
      throw new HttpException(
        { title: 'KYC não aprovado ou vencido', status: 409, principio_violado: 'P7' }, 409);
    }
    const atestacao = sha256Hex(`kyc:${corpo.produtor_ref}:${s.valido_ate}`);
    const validoAte = Math.floor(new Date(s.valido_ate as string).getTime() / 1000);
    const participantes = this.chain.participantes('compliance');
    const tx = await participantes.habilitar(corpo.endereco, atestacao, validoAte);
    const recibo = await tx.wait();
    return { endereco: corpo.endereco, atestacao_hash: atestacao, valido_ate: s.valido_ate, tx: recibo.hash };
  }

  /** Desabilita e emite o evento de má notícia que faltava (SMC-004). */
  @Post('/participantes/desabilitar')
  async desabilitar(@Body() corpo: { endereco: string; motivo: string }) {
    const participantes = this.chain.participantes('compliance');
    const tx = await participantes.desabilitar(corpo.endereco, sha256Hex(corpo.motivo));
    const recibo = await tx.wait();
    return { endereco: corpo.endereco, motivo: corpo.motivo, tx: recibo.hash };
  }

  /** Única rota do sistema que aceita dado identificável (P2, ADR-0002). */
  @Post('/onboarding')
  async onboarding(@Headers('x-correlacao-id') cid: string, @Body() corpo: EntradaOnboarding) {
    const ctx = ctxDe(cid);
    const r = await this.cofre.onboarding(ctx, corpo);
    if ('_interno' in r && r._interno) {
      const { produtorId, titularId, entrada } = r._interno;
      const kyc = await this.cofre.executarKyc(ctx, produtorId, titularId, entrada);
      return { produtor_ref: r.produtor_ref, situacao: kyc.aprovado ? 'APROVADO' : 'REPROVADO' };
    }
    return { produtor_ref: r.produtor_ref, situacao: r.situacao };
  }

  @Get('/produtores/:ref/situacao')
  async situacao(@Param('ref') ref: string) {
    const s = await this.cofre.situacao(ref);
    if (!s) throw new HttpException({ title: 'Produtor não encontrado', status: 404 }, 404);
    return s;
  }

  @Get('/produtores/:ref/credenciais')
  listarCredenciais(@Param('ref') ref: string) { return this.credenciais.listar(ref); }

  @Post('/produtores/:ref/credenciais')
  async emitirCredencial(
    @Headers('x-correlacao-id') cid: string,
    @Param('ref') ref: string,
    @Body() corpo: { tipo: string; expira_em?: string },
  ) {
    const r = await this.credenciais.emitir(ctxDe(cid), ref, corpo.tipo, corpo.expira_em);
    if (!r) throw new HttpException({ title: 'Produtor não encontrado', status: 404 }, 404);
    return r;
  }

  @Post('/verificacoes/credencial')
  verificar(@Body() corpo: { vc: { payload: unknown; assinatura: string; emissor: string } }) {
    return this.credenciais.verificar(corpo.vc);
  }

  @Post('/titulares/:ref/eliminacao')
  async eliminar(
    @Headers('x-correlacao-id') cid: string,
    @Param('ref') ref: string,
    @Body() corpo: { canal: string; solicitante: string },
  ) {
    const r = await this.eliminacao.eliminar(ctxDe(cid), ref, corpo.canal, corpo.solicitante);
    if (!r) throw new HttpException({ title: 'Titular não encontrado', status: 404 }, 404);
    return r;
  }

  @Get('/titulares/:ref/eliminacao')
  async comprovante(@Param('ref') ref: string) {
    const r = await this.eliminacao.comprovante(ref);
    if (!r) throw new HttpException({ title: 'Sem pedido de eliminação', status: 404 }, 404);
    return r;
  }

  /** Registro de operações de tratamento — o que o regulador pede primeiro. */
  @Get('/tratamentos')
  async tratamentos(@Query('produtor_ref') ref?: string, @Query('desde') desde?: string) {
    let titularId: string | null = null;
    if (ref) {
      const { rows } = await poolOps().query<{ pii_ref: string }>(
        'SELECT pii_ref FROM ops.produtor WHERE ref_opaca = $1', [Buffer.from(ref, 'hex')]);
      titularId = rows[0]?.pii_ref ?? null;
      if (!titularId) return [];
    }
    const { rows } = await poolPii().query(
      `SELECT operacao, finalidade, base_legal, campos, destinatario, solicitante, ocorrido_em
         FROM pii.operacao_tratamento
        WHERE ($1::uuid IS NULL OR titular_id = $1)
          AND ($2::timestamptz IS NULL OR ocorrido_em >= $2)
        ORDER BY ocorrido_em DESC LIMIT 500`,
      [titularId, desde ?? null]);
    return rows;
  }

  /** Placar de custo de verificação por produtor — a lacuna F1 (SMC-007). */
  @Get('/placar/custo-verificacao')
  async placarCusto() {
    const { rows } = await poolOps().query(
      `SELECT porte,
              count(*)                                    AS produtores,
              round(avg(tarifa_total_centavos)/100.0, 2)  AS tarifa_media_reais,
              round(avg(esforco_humano_seg)/60.0, 1)      AS esforco_medio_min,
              round(avg(pct_automatico), 1)               AS pct_automatico_medio
         FROM ops.vw_custo_por_produtor
        WHERE etapas_kyc > 0
        GROUP BY porte ORDER BY porte`);
    return rows;
  }
}
