import { Body, Controller, Get, Headers, HttpException, Param, Post, Query, Res } from '@nestjs/common';
import { poolOps, versaoServico, Contexto, ProblemaCpr, verificarCadeia , Escopos, Publica } from '@cpr/nucleo';
import { OriginacaoService, RascunhoEntrada } from './originacao.service';
import { ConciliacaoService } from './conciliacao.service';
import { MercadoService } from './mercado.service';
import { WaterfallService } from './waterfall.service';
import { LiquidacaoService } from './liquidacao.service';

const ctxDe = (c?: string): Contexto => ({
  correlacaoId: c ?? crypto.randomUUID(), origem: versaoServico('services/core'),
});

const tratar = (e: unknown): never => {
  if (e instanceof ProblemaCpr) throw new HttpException(e.corpo(), e.status);
  throw new HttpException({ title: (e as Error).message, status: 422 }, 422);
};

@Controller()
export class AppController {
  constructor(
    private readonly originacao: OriginacaoService,
    private readonly conciliacao: ConciliacaoService,
    private readonly mercado: MercadoService,
    private readonly waterfall: WaterfallService,
    private readonly liquidacao: LiquidacaoService,
  ) {}

  @Publica()
  @Get('/saude')
  saude() { return { servico: 'core', ok: true }; }

  // ------------------------------------------------------------- contratos
  @Escopos('contrato:ler')
  @Get('/contratos')
  async listar(@Query('estado') estado?: string, @Query('situacao_conciliacao') sit?: string) {
    const { rows } = await poolOps().query(
      `SELECT c.id, c.registro_id, c.estado, c.situacao_conciliacao, c.commodity,
              c.quantidade_sacas, c.valor_face, c.valor_mtm, c.vencimento, c.selo_eudr,
              encode(p.ref_opaca,'hex') AS produtor_ref, c.token_id
         FROM ops.contrato c JOIN ops.produtor p ON p.id = c.produtor_id
        WHERE ($1::text IS NULL OR c.estado::text = $1)
          AND ($2::text IS NULL OR c.situacao_conciliacao::text = $2)
        ORDER BY c.criado_em DESC LIMIT 200`, [estado ?? null, sit ?? null]);
    return { itens: rows, proximo_cursor: null };
  }

  @Escopos('contrato:ler')
  @Get('/contratos/:id')
  async obter(@Param('id') id: string, @Res({ passthrough: true }) res: { header: (k: string, v: string) => void }) {
    const { rows } = await poolOps().query(
      `SELECT c.*, encode(p.ref_opaca,'hex') AS produtor_ref,
              encode(c.registro_hash_ancora,'hex') AS ancora_hex
         FROM ops.contrato c JOIN ops.produtor p ON p.id = c.produtor_id WHERE c.id = $1`, [id]);
    if (!rows.length) throw new HttpException({ title: 'Contrato não encontrado', status: 404 }, 404);
    const c = rows[0];
    res.header('X-Conciliacao-Situacao', c.situacao_conciliacao);
    return {
      ...c,
      registro_hash_ancora: '0x' + c.ancora_hex,
      registro_hash_ancora_bin: undefined,
      token_contrato_addr: c.token_contrato_addr ? '0x' + c.token_contrato_addr.toString('hex') : null,
      credor_ref: c.credor_ref ? c.credor_ref.toString('hex') : null,
    };
  }

  @Escopos('contrato:escrever')
  @Post('/contratos')
  async criar(@Headers('x-correlacao-id') cid: string, @Body() corpo: RascunhoEntrada) {
    try { return await this.originacao.criarRascunho(ctxDe(cid), corpo); } catch (e) { return tratar(e); }
  }

  @Escopos('contrato:escrever')
  @Post('/contratos/:id/verificacao')
  async verificar(@Headers('x-correlacao-id') cid: string, @Param('id') id: string) {
    await this.originacao.enviarParaVerificacao(ctxDe(cid), id);
    return { contrato_id: id, estado: 'EM_VERIFICACAO' };
  }

  @Escopos('contrato:escrever')
  @Post('/contratos/:id/registro')
  async registrar(@Headers('x-correlacao-id') cid: string, @Param('id') id: string) {
    try { return await this.originacao.registrar(ctxDe(cid), id); } catch (e) { return tratar(e); }
  }

  @Escopos('contrato:escrever')
  @Post('/contratos/:id/espelho')
  async espelhar(
    @Headers('x-correlacao-id') cid: string, @Param('id') id: string,
    @Body() corpo: { titular_endereco?: string },
  ) {
    try {
      const endereco = corpo?.titular_endereco ?? this.originacao.cadeiaPublica.enderecoCredor(1);
      return await this.originacao.espelhar(ctxDe(cid), id, endereco);
    } catch (e) { return tratar(e); }
  }

  // ----------------------------------------------------------- conciliação
  @Escopos('conciliacao:executar')
  @Post('/conciliacao/executar')
  async conciliar(@Headers('x-correlacao-id') cid: string, @Body() corpo: { contrato_id?: string }) {
    return this.conciliacao.executar(ctxDe(cid), corpo?.contrato_id ? 'CONTRATO' : 'COMPLETA', corpo?.contrato_id);
  }

  @Escopos('contrato:ler')
  @Get('/contratos/:id/conciliacao')
  async situacaoConciliacao(@Param('id') id: string) {
    const { rows: c } = await poolOps().query(
      'SELECT situacao_conciliacao FROM ops.contrato WHERE id = $1', [id]);
    if (!c.length) throw new HttpException({ title: 'Contrato não encontrado', status: 404 }, 404);
    const { rows: d } = await poolOps().query(
      `SELECT id, tipo, severidade, estado, campo, valor_registro, valor_onchain,
              ocorrida_em, detectada_em, latencia_deteccao_ms, congelou_contrato
         FROM ops.divergencia WHERE contrato_id = $1 ORDER BY detectada_em DESC`, [id]);
    const { rows: e } = await poolOps().query(
      'SELECT max(concluida_em) AS ultima FROM ops.conciliacao_execucao');
    return { situacao: c[0].situacao_conciliacao, ultima_execucao_em: e[0].ultima, divergencias: d };
  }

  @Escopos('contrato:ler')
  @Get('/conciliacao/divergencias')
  async divergencias(@Query('estado') estado?: string, @Query('severidade') sev?: string) {
    const { rows } = await poolOps().query(
      `SELECT d.*, c.registro_id FROM ops.divergencia d LEFT JOIN ops.contrato c ON c.id = d.contrato_id
        WHERE ($1::text IS NULL OR d.estado::text = $1) AND ($2::text IS NULL OR d.severidade::text = $2)
        ORDER BY d.detectada_em DESC LIMIT 200`, [estado ?? null, sev ?? null]);
    return rows;
  }

  @Escopos('conciliacao:reconciliar')
  @Post('/conciliacao/divergencias/:id/reconciliacao')
  async reconciliar(
    @Headers('x-correlacao-id') cid: string, @Param('id') id: string,
    @Body() corpo: { decisao: 'ACEITAR_REGISTRO' | 'MARCAR_FALSO_POSITIVO'; justificativa: string; operador: string; ator_ref: string },
  ) {
    try {
      const ctx = ctxDe(cid);
      const r = await this.conciliacao.reconciliar(
        ctx, id, corpo.decisao, corpo.justificativa, corpo.operador, corpo.ator_ref);
      if (r.contrato_descongelado) {
        const { rows } = await poolOps().query('SELECT contrato_id FROM ops.divergencia WHERE id = $1', [id]);
        if (rows[0]?.contrato_id) await this.conciliacao.descongelarOnchain(rows[0].contrato_id, id);
      }
      return r;
    } catch (e) { return tratar(e); }
  }

  @Escopos('conciliacao:executar')
  @Post('/conciliacao/divergencias/:id/congelar-onchain')
  async congelarOnchain(@Headers('x-correlacao-id') cid: string, @Param('id') id: string) {
    const { rows } = await poolOps().query('SELECT contrato_id FROM ops.divergencia WHERE id = $1', [id]);
    const tx = await this.conciliacao.congelarOnchain(ctxDe(cid), rows[0].contrato_id, id);
    return { divergencia_id: id, tx_congelamento: tx };
  }

  /** Placar da lacuna nº 1: injetadas, detectadas e latência por tipo. */
  @Escopos('auditoria:ler')
  @Get('/placar/conciliacao')
  async placar() {
    const { rows } = await poolOps().query(
      `SELECT tipo, injetadas, detectadas, latencia_p50_ms, latencia_max_ms,
              sla_deteccao::text AS sla, dentro_do_sla
         FROM ops.vw_placar_conciliacao ORDER BY tipo`);
    const total = rows.reduce((s, r) => s + Number(r.injetadas), 0);
    const det = rows.reduce((s, r) => s + Number(r.detectadas), 0);
    return { por_tipo: rows, total_injetadas: total, total_detectadas: det,
             cobertura_pct: total ? Number(((det / total) * 100).toFixed(1)) : null };
  }

  // -------------------------------------------------------- mercado e risco
  @Escopos('contrato:escrever')
  @Post('/contratos/:id/marcacao')
  async marcar(@Headers('x-correlacao-id') cid: string, @Param('id') id: string,
               @Body() corpo: { haircut_pct?: number }) {
    try { return await this.mercado.marcar(ctxDe(cid), id, corpo?.haircut_pct ?? 20); } catch (e) { return tratar(e); }
  }

  @Escopos('contrato:ler')
  @Get('/contratos/:id/garantias')
  async garantias(@Param('id') id: string) {
    const { rows } = await poolOps().query(
      `SELECT id, tipo, nivel_waterfall, valor_declarado, valor_avaliado, estado_excussao,
              oponibilidade, averbada_em, registro_publico_ref
         FROM ops.garantia WHERE contrato_id = $1 ORDER BY nivel_waterfall`, [id]);
    return rows;
  }

  @Escopos('contrato:escrever')
  @Post('/contratos/:id/garantias')
  async vincularGarantia(@Param('id') id: string, @Body() corpo: Record<string, unknown>) {
    const { rows } = await poolOps().query(
      `INSERT INTO ops.garantia (contrato_id, tipo, nivel_waterfall, valor_declarado, talhao_id,
                                 registro_publico_ref, oponibilidade, averbada_em, averbacao_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [id, corpo.tipo, corpo.nivel_waterfall, corpo.valor_declarado, corpo.talhao_id ?? null,
       corpo.registro_publico_ref ?? null, corpo.oponibilidade ?? 'NAO_AVERBADA',
       corpo.averbada_em ?? null, corpo.averbacao_ref ?? null]);
    return { id: rows[0].id };
  }

  @Escopos('contrato:ler')
  @Post('/simulacoes/waterfall')
  async simular(@Headers('x-correlacao-id') cid: string, @Body() corpo: Record<string, any>) {
    try { return await this.waterfall.simular(ctxDe(cid), corpo as never); } catch (e) { return tratar(e); }
  }

  // -------------------------------------------------------------- liquidação
  @Escopos('contrato:escrever')
  @Post('/contratos/:id/liquidacao')
  async liquidar(@Headers('x-correlacao-id') cid: string, @Param('id') id: string,
                 @Body() corpo: { baixa_registro_ref: string }) {
    try { return await this.liquidacao.liquidar(ctxDe(cid), id, corpo.baixa_registro_ref); } catch (e) { return tratar(e); }
  }

  @Escopos('contrato:escrever')
  @Post('/contratos/:id/inadimplencia')
  async inadimplir(@Headers('x-correlacao-id') cid: string, @Param('id') id: string,
                   @Body() corpo: { gatilho: string; leituras?: string[] }) {
    try { return await this.liquidacao.marcarInadimplente(ctxDe(cid), id, corpo.gatilho, corpo.leituras ?? []); }
    catch (e) { return tratar(e); }
  }

  // --------------------------------------------------------------- auditoria
  /** O que se sabia, quando e com base em quê (P5). Alimenta o painel de W6. */
  @Escopos('auditoria:ler')
  @Get('/contratos/:id/trilha')
  async trilha(@Param('id') id: string, @Query('ate') ate?: string) {
    const { rows } = await poolOps().query(
      `SELECT quando, categoria, fato, origem, evidencia
         FROM ops.vw_conhecimento_contrato
        WHERE contrato_id = $1 AND ($2::timestamptz IS NULL OR quando <= $2)
        ORDER BY quando`, [id, ate ?? null]);
    return rows;
  }

  @Escopos('auditoria:ler')
  @Get('/auditoria/cadeia')
  async cadeia() { return verificarCadeia(); }

  @Escopos('auditoria:ler')
  @Get('/reacoes')
  async listarReacoes(@Query('contrato_id') contratoId?: string) {
    const { rows } = await poolOps().query(
      `SELECT contrato_id, encode(credor_ref,'hex') AS credor_ref, acao, taxa_ofertada_pct,
              prazo_ofertado_dias, motivo_recusa, ocorrido_em
         FROM ops.reacao_credor WHERE ($1::uuid IS NULL OR contrato_id = $1)
        ORDER BY ocorrido_em DESC LIMIT 200`, [contratoId ?? null]);
    return rows;
  }

  /** F7: reação revelada do credor. Painel bonito não mede disposição a pagar. */
  @Escopos('contrato:ler')
  @Post('/reacoes')
  async registrarReacao(@Body() corpo: Record<string, unknown>) {
    await poolOps().query(
      `INSERT INTO ops.reacao_credor (contrato_id, credor_ref, acao, taxa_ofertada_pct,
                                      prazo_ofertado_dias, motivo_recusa)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [corpo.contrato_id, Buffer.from(String(corpo.credor_ref), 'hex'), corpo.acao,
       corpo.taxa_ofertada_pct ?? null, corpo.prazo_ofertado_dias ?? null, corpo.motivo_recusa ?? null]);
    return { ok: true };
  }
}
