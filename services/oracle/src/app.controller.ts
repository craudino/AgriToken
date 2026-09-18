import { Body, Controller, Get, Headers, HttpException, Param, Post, Query } from '@nestjs/common';
import { poolOps, emTransacao, publicar, versaoServico, Contexto, ProblemaCpr, log, TipoLeitura , Escopos, Publica } from '@cpr/nucleo';
import { QuorumService } from './quorum.service';
import * as fontes from './fontes';

const ctxDe = (c?: string): Contexto => ({
  correlacaoId: c ?? crypto.randomUUID(), origem: versaoServico('services/oracle'),
});

@Controller()
export class AppController {
  constructor(private readonly quorum: QuorumService) {}

  @Publica()
  @Get('/saude')
  saude() { return { servico: 'oracle', ok: true }; }

  @Escopos('oraculo:coletar')
  @Post('/leituras/coletar')
  async coletar(
    @Headers('x-correlacao-id') cid: string,
    @Body() corpo: { tipo: TipoLeitura; chave: string; url?: string },
  ) {
    return this.quorum.coletar(ctxDe(cid), corpo.tipo, corpo.chave, { url: corpo.url });
  }

  /** Contrato de fronteira com A2 e A4: 200 com quórum, 503 sem ele. */
  @Escopos('oraculo:ler')
  @Get('/leituras/efetiva')
  async efetiva(@Query('tipo') tipo: TipoLeitura, @Query('chave') chave: string) {
    try {
      return await this.quorum.efetiva(tipo, chave);
    } catch (e) {
      if (e instanceof ProblemaCpr) throw new HttpException(e.corpo(), e.status);
      throw e;
    }
  }

  @Escopos('oraculo:ler')
  @Get('/leituras/:id/linhagem')
  async linhagem(@Param('id') id: string) {
    const l = await this.quorum.linhagem(id);
    if (!l) throw new HttpException({ title: 'Leitura não encontrada', status: 404 }, 404);
    return l;
  }

  /**
   * Abrir disputa suspende o efeito contratual imediatamente, sem apagar a
   * leitura. Decisões já tomadas com base nela são reexaminadas pelo núcleo,
   * não revertidas silenciosamente aqui.
   */
  @Escopos('oraculo:disputar')
  @Post('/leituras/:id/disputas')
  async disputar(
    @Headers('x-correlacao-id') cid: string,
    @Param('id') id: string,
    @Body() corpo: { fundamento: string; aberta_por_ref: string },
  ) {
    if (!corpo.fundamento || corpo.fundamento.length < 20) {
      throw new HttpException({ title: 'Fundamento insuficiente', status: 422 }, 422);
    }
    const ctx = ctxDe(cid);
    return emTransacao(poolOps(), async (c) => {
      const prazo = new Date(Date.now() + 7 * 86400_000);
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO ops.disputa_leitura (leitura_id, aberta_por_ref, fundamento, prazo_ate)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [id, Buffer.from(corpo.aberta_por_ref, 'hex'), corpo.fundamento, prazo]);
      await c.query("UPDATE ops.leitura_oraculo SET estado = 'EM_DISPUTA' WHERE id = $1", [id]);
      await publicar(c, ctx, {
        tipo: 'oraculo.disputa-aberta', sujeitoTipo: 'LEITURA', sujeitoId: id,
        payload: { disputa_id: rows[0].id, leitura_id: id, aberta_por_ref: corpo.aberta_por_ref,
                   prazo_ate: prazo.toISOString() },
        evidencia: [{ tipo: 'LEITURA_ORACULO', hash: '0x' + '0'.repeat(64), id }],
      });
      log.aviso(ctx, 'disputa aberta: efeito contratual suspenso', { leitura_id: id });
      return { id: rows[0].id, leitura_id: id, prazo_ate: prazo.toISOString(), resolucao: null };
    });
  }

  @Escopos('oraculo:ler')
  @Get('/fontes')
  async listarFontes() {
    const { rows } = await poolOps().query(
      `SELECT codigo, tipo_leitura AS tipo, operador, ativa, peso, independente_de
         FROM ops.fonte_oraculo ORDER BY tipo_leitura, codigo`);
    const derrubadas = new Set(fontes.fontesDerrubadas());
    return rows.map((r: Record<string, unknown>) => ({ ...r, disponivel: !derrubadas.has(r.codigo as string) }));
  }

  @Escopos('oraculo:ler')
  @Get('/politicas')
  async politicas() {
    const { rows } = await poolOps().query('SELECT * FROM ops.politica_quorum ORDER BY tipo_leitura');
    return rows;
  }

  @Escopos('oraculo:ler')
  @Get('/saude/degradacao')
  degradacao() { return this.quorum.degradacao(); }

  // ---- superfície de teste (aceite de W3): derrubar e levantar fontes -------
  @Escopos('simulador:operar')
  @Post('/sim/fonte/:codigo/derrubar')
  derrubar(@Param('codigo') codigo: string) { fontes.derrubar(codigo); return { fonte: codigo, disponivel: false }; }

  @Escopos('simulador:operar')
  @Post('/sim/fonte/:codigo/levantar')
  levantar(@Param('codigo') codigo: string) { fontes.levantar(codigo); return { fonte: codigo, disponivel: true }; }

  @Escopos('simulador:operar')
  @Post('/sim/dia')
  dia(@Body() corpo: { dia?: number; avancar?: number }) {
    const d = corpo.dia !== undefined ? fontes.definirDia(corpo.dia) : fontes.avancarDia(corpo.avancar ?? 1);
    return { dia: d };
  }

  @Escopos('simulador:operar')
  @Post('/sim/pagamento')
  pagamento(@Body() corpo: { chave: string; valor: string }) {
    fontes.confirmarPagamento(corpo.chave, corpo.valor);
    return { chave: corpo.chave, confirmado: true };
  }

  /**
   * Publicação de resultado por fonte.
   *
   * O cruzamento geoespacial é computado por services/eudr, que detém a
   * geometria e o PostGIS; o oráculo é quem aplica o quórum. Antes isso
   * trafegava por uma rota de simulação, o que dava a esta operação legítima a
   * mesma porta usada para injetar falha — e ela sumiria fora de
   * desenvolvimento. Agora tem rota própria e escopo próprio, concedido ao
   * perfil de serviço e a mais ninguém.
   *
   * Registre-se a dívida: o desenho-alvo é o adaptador geoespacial ler as bases
   * por conta própria, como faz o de preço. Enquanto isso não existe, quem
   * publica é o serviço que calcula, e o quórum continua sendo do oráculo.
   */
  @Escopos('oraculo:publicar-fonte')
  @Post('/leituras/fonte')
  publicarFonte(@Body() corpo: { tipo: string; chave: string; fonte: string; resultado: unknown }) {
    if (corpo.tipo !== 'GEOESPACIAL') {
      throw new HttpException(
        { title: 'Só leitura geoespacial é publicada por serviço externo', status: 422 }, 422);
    }
    fontes.publicarGeo(corpo.chave, corpo.fonte, corpo.resultado);
    return { chave: corpo.chave, fonte: corpo.fonte, publicada: true };
  }
}
