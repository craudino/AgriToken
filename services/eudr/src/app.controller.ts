import { Body, Controller, Get, Headers, HttpException, Param, Post, Query } from '@nestjs/common';
import { poolOps, versaoServico, Contexto, ProblemaCpr , Escopos, Publica } from '@cpr/nucleo';
import { GeoService } from './geo.service';
import { EudrService } from './eudr.service';

const ctxDe = (c?: string): Contexto => ({
  correlacaoId: c ?? crypto.randomUUID(), origem: versaoServico('services/eudr'),
});
const tratar = (e: unknown): never => {
  if (e instanceof ProblemaCpr) throw new HttpException(e.corpo(), e.status);
  throw new HttpException({ title: (e as Error).message, status: 422 }, 422);
};

@Controller()
export class AppController {
  constructor(private readonly geo: GeoService, private readonly eudr: EudrService) {}

  @Publica()
  @Get('/saude')
  saude() { return { servico: 'eudr', ok: true }; }

  @Escopos('simulador:operar')
  @Post('/sim/bases/carregar')
  carregar(@Headers('x-correlacao-id') cid: string) { return this.geo.carregarBases(ctxDe(cid)); }

  @Escopos('geo:ingerir')
  @Post('/talhoes')
  async ingerir(@Headers('x-correlacao-id') cid: string, @Body() corpo: Record<string, any>) {
    try { return await this.geo.ingerir(ctxDe(cid), corpo as never); } catch (e) { return tratar(e); }
  }

  @Escopos('contrato:ler')
  @Get('/talhoes/:id')
  async talhao(@Param('id') id: string) {
    const t = await this.geo.metadados(id);
    if (!t) throw new HttpException({ title: 'Talhão não encontrado', status: 404 }, 404);
    return t;
  }

  /** Geometria bruta exige finalidade declarada, e o acesso fica registrado (P2). */
  @Escopos('geo:bruto')
  @Get('/talhoes/:id/geometria')
  async geometria(@Param('id') id: string, @Query('finalidade') finalidade?: string) {
    if (!finalidade) {
      throw new HttpException(
        { title: 'Finalidade obrigatória para acesso a geometria bruta', status: 403, principio_violado: 'P2' }, 403);
    }
    const g = await this.geo.geometria(id, finalidade);
    if (!g) throw new HttpException({ title: 'Talhão sem geometria', status: 404 }, 404);
    return g;
  }

  @Escopos('geo:avaliar')
  @Post('/talhoes/:id/avaliacoes')
  async avaliar(@Headers('x-correlacao-id') cid: string, @Param('id') id: string) {
    try { return await this.eudr.avaliar(ctxDe(cid), id); } catch (e) { return tratar(e); }
  }

  @Escopos('geo:avaliar')
  @Post('/talhoes/:id/reavaliacoes')
  async reavaliar(@Headers('x-correlacao-id') cid: string, @Param('id') id: string) {
    try { return await this.eudr.reavaliar(ctxDe(cid), id); } catch (e) { return tratar(e); }
  }

  @Escopos('contrato:ler')
  @Get('/evidencias/:id')
  async evidencia(@Param('id') id: string) {
    const e = await this.eudr.obter(id);
    if (!e) throw new HttpException({ title: 'Evidência não encontrada', status: 404 }, 404);
    return e;
  }

  @Escopos('auditoria:ler')
  @Post('/evidencias/:id/reproducao')
  async reproduzir(@Param('id') id: string) {
    const r = await this.eudr.reproduzir(id);
    if (!r) throw new HttpException({ title: 'Evidência não encontrada', status: 404 }, 404);
    return r;
  }

  @Escopos('dds:emitir')
  @Post('/dds')
  async dds(@Headers('x-correlacao-id') cid: string,
            @Body() corpo: { contrato_id: string; evidencias: string[]; operador_ref: string }) {
    try { return await this.eudr.emitirDds(ctxDe(cid), corpo.contrato_id, corpo.evidencias, corpo.operador_ref); }
    catch (e) { return tratar(e); }
  }

  @Escopos('contrato:ler')
  @Get('/bases')
  async bases() {
    const { rows } = await poolOps().query(
      `SELECT codigo, versao, data_corte, publicada_em, encode(hash_dataset,'hex') AS hash_dataset
         FROM ops.base_referencia_geo ORDER BY codigo, versao DESC`);
    return rows.map((r: Record<string, unknown>) => ({ ...r, hash_dataset: '0x' + r.hash_dataset }));
  }

  /** Placar de custo do selo por hectare — a lacuna F4 (SMC-007). */
  @Escopos('auditoria:ler')
  @Get('/placar/custo-selo')
  async placarCusto() {
    const { rows } = await poolOps().query(
      `SELECT count(*) AS talhoes,
              round(avg(tarifa_total_centavos)/100.0, 2) AS tarifa_media_reais,
              round(avg(centavos_por_hectare)/100.0, 4)  AS reais_por_hectare,
              round(avg(duracao_total_ms))               AS duracao_media_ms
         FROM ops.vw_custo_selo_eudr WHERE cruzamentos > 0`);
    return rows[0];
  }
}
