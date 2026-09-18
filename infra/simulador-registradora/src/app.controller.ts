import { Body, Controller, Get, HttpException, Param, Post, Query } from '@nestjs/common';
import { poolOps, hashPayload, canonico, TipoDivergencia , Escopos, Publica } from '@cpr/nucleo';
import { aplicar, LADO, Titulo } from './injecoes';

/**
 * Simulador de registradora (Briefing 6.2). Interface idêntica à que se espera
 * da integração real, com uma diferença deliberada: **não existe verbo de
 * escrita em /titulos**. A ausência é o contrato — nenhum caminho corrige o
 * registro a partir do token (P1).
 *
 * As rotas /sim existem apenas aqui e não têm contrapartida em produção. As
 * premissas que esta interface embute estão declaradas no ADR-0006, e o placar
 * de detecção reporta qual premissa cada tipo depende.
 */
@Controller()
export class AppController {
  private falha: { modo: string; ate: number } | null = null;

  private conferirFalha() {
    if (!this.falha || Date.now() > this.falha.ate) { this.falha = null; return; }
    if (this.falha.modo === 'QUEDA') throw new HttpException({ title: 'Registradora indisponível', status: 503 }, 503);
    if (this.falha.modo === 'CERTIFICADO_INVALIDO') throw new HttpException({ title: 'Falha de TLS', status: 526 }, 526);
  }

  @Publica()
  @Get('/saude')
  saude() { return { servico: 'simulador-registradora', ok: true, falha: this.falha }; }

  @Escopos('registro:ler')
  @Get('/titulos/:entidade/:registroId')
  async titulo(@Param('entidade') entidade: string, @Param('registroId') registroId: string) {
    this.conferirFalha();
    const { rows } = await poolOps().query<{ conteudo: Titulo }>(
      'SELECT conteudo FROM sim.titulo WHERE registro_entidade = $1 AND registro_id = $2',
      [entidade, registroId]);
    if (!rows.length) {
      throw new HttpException({ title: 'Título inexistente no registro', status: 404 }, 404);
    }
    return rows[0].conteudo;
  }

  @Escopos('registro:ler')
  @Get('/titulos')
  async alteracoes(@Query('desde') desde?: string) {
    this.conferirFalha();
    const { rows } = await poolOps().query<{ conteudo: Titulo }>(
      `SELECT conteudo FROM sim.titulo
        WHERE ($1::timestamptz IS NULL OR atualizado_em >= $1)
        ORDER BY atualizado_em DESC LIMIT 500`, [desde ?? null]);
    return { itens: rows.map((r) => r.conteudo), proximo_cursor: null };
  }

  /** Registro de título. É o que a registradora faria; aqui é simulado. */
  @Escopos('simulador:operar')
  @Post('/sim/titulos')
  async registrar(@Body() corpo: Omit<Titulo, 'conteudo_hash' | 'atualizado_em'>) {
    const conteudo: Titulo = {
      ...corpo,
      conteudo_hash: hashPayload({ ...corpo, conteudo_hash: undefined }),
      atualizado_em: new Date().toISOString(),
    };
    await poolOps().query(
      `INSERT INTO sim.titulo (registro_entidade, registro_id, conteudo)
       VALUES ($1,$2,$3)
       ON CONFLICT (registro_entidade, registro_id)
       DO UPDATE SET conteudo = $3, versao = sim.titulo.versao + 1, atualizado_em = now()`,
      [corpo.entidade, corpo.registro_id, JSON.stringify(conteudo)]);
    return conteudo;
  }

  @Escopos('simulador:operar')
  @Post('/sim/injecoes')
  async injetar(@Body() corpo: {
    tipo: TipoDivergencia; entidade: string; registro_id: string; parametros?: Record<string, unknown>;
  }) {
    const lado = LADO[corpo.tipo];
    const { rows } = await poolOps().query<{ conteudo: Titulo }>(
      'SELECT conteudo FROM sim.titulo WHERE registro_entidade = $1 AND registro_id = $2',
      [corpo.entidade, corpo.registro_id]);
    if (!rows.length && lado !== 'TOKEN') {
      throw new HttpException({ title: 'Título não registrado', status: 404 }, 404);
    }

    if (lado === 'REGISTRO' && rows.length) {
      const novo = aplicar(rows[0].conteudo, corpo.tipo, corpo.parametros ?? {});
      if (novo === null) {
        await poolOps().query(
          'DELETE FROM sim.titulo WHERE registro_entidade = $1 AND registro_id = $2',
          [corpo.entidade, corpo.registro_id]);
      } else {
        await poolOps().query(
          `UPDATE sim.titulo SET conteudo = $3, versao = versao + 1, atualizado_em = now()
            WHERE registro_entidade = $1 AND registro_id = $2`,
          [corpo.entidade, corpo.registro_id, JSON.stringify(novo)]);
      }
    }

    const { rows: inj } = await poolOps().query<{ id: string; injetada_em: Date }>(
      `INSERT INTO sim.injecao (tipo, registro_entidade, registro_id, parametros)
       VALUES ($1,$2,$3,$4) RETURNING id, injetada_em`,
      [corpo.tipo, corpo.entidade, corpo.registro_id, JSON.stringify(corpo.parametros ?? {})]);

    return {
      id: inj[0].id, tipo: corpo.tipo, lado,
      entidade: corpo.entidade, registro_id: corpo.registro_id,
      injetada_em: inj[0].injetada_em,
      detectada_em: null, latencia_ms: null, divergencia_id: null,
      observacao: lado === 'TOKEN'
        ? 'Divergência do lado do token: o efeito é produzido na cadeia pelo roteiro, não aqui.'
        : null,
    };
  }

  @Escopos('simulador:operar')
  @Get('/sim/injecoes/:id')
  async injecao(@Param('id') id: string) {
    const { rows } = await poolOps().query(
      `SELECT id, tipo, registro_entidade, registro_id, injetada_em,
              detectada_em, latencia_ms, detectada_divergencia_id AS divergencia_id
         FROM sim.injecao WHERE id = $1`, [id]);
    if (!rows.length) throw new HttpException({ title: 'Injeção não encontrada', status: 404 }, 404);
    return rows[0];
  }

  @Escopos('simulador:operar')
  @Post('/sim/indisponibilidade')
  indisponibilidade(@Body() corpo: { modo: string; duracao_s: number }) {
    this.falha = { modo: corpo.modo, ate: Date.now() + corpo.duracao_s * 1000 };
    return { modo: corpo.modo, ate: new Date(this.falha.ate).toISOString() };
  }
}
