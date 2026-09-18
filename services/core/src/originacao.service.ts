import { Injectable } from '@nestjs/common';
import {
  poolOps, emTransacao, publicar, hashPayload, sha256Hex, canonico, Contexto, log,
  ProblemaCpr, invalido, congelado, ancoraEmUso, comCusto,
} from '@cpr/nucleo';
import { Cadeia, ancoraDe, hashDe } from '@cpr/nucleo';

const URL_COMPLIANCE = process.env.URL_COMPLIANCE ?? 'http://127.0.0.1:3001';
const URL_REGISTRADORA = process.env.URL_REGISTRADORA ?? 'http://127.0.0.1:3005';
const ENTIDADE = 'REG-SIM';

export interface RascunhoEntrada {
  produtor_ref: string;
  commodity: 'CAFE_ARABICA' | 'CAFE_CONILON';
  quantidade_sacas: string;
  safra: string;
  vencimento: string;
  valor_face: { valor: string; moeda: 'BRL' };
  talhoes: Array<{ talhao_id: string; sacas_alocadas: string }>;
}

@Injectable()
export class OriginacaoService {
  private cadeia: Cadeia | null = null;
  private get chain(): Cadeia { return (this.cadeia ??= new Cadeia()); }

  /**
   * Cria o rascunho. Não recebe nome, documento nem polígono: o produtor entra
   * por referência opaca (P2), e a habilitação vem do compliance como
   * atestação — o núcleo nunca vê o dossiê que a sustenta.
   */
  async criarRascunho(ctx: Contexto, e: RascunhoEntrada) {
    const r = await fetch(`${URL_COMPLIANCE}/produtores/${e.produtor_ref}/situacao`);
    if (!r.ok) throw invalido('produtor desconhecido');
    const situacao = await r.json() as { habilitado_a_originar: boolean; situacao: string };
    if (!situacao.habilitado_a_originar) {
      throw new ProblemaCpr(422, 'produtor-nao-habilitado',
        'Produtor não habilitado a originar', `situação: ${situacao.situacao}`);
    }

    const { rows: p } = await poolOps().query<{ id: string }>(
      'SELECT id FROM ops.produtor WHERE ref_opaca = $1', [Buffer.from(e.produtor_ref, 'hex')]);

    return emTransacao(poolOps(), async (c) => {
      const registroId = `CPR-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1e4)}`;
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO ops.contrato
           (registro_id, registro_entidade, registro_hash_ancora, produtor_id, commodity,
            quantidade_sacas, safra, vencimento, valor_face)
         VALUES ($1,$2, decode($3,'hex'), $4,$5,$6,$7,$8,$9) RETURNING id`,
        [registroId, ENTIDADE, ancoraDe(ENTIDADE, registroId).slice(2), p[0].id, e.commodity,
         e.quantidade_sacas, e.safra, e.vencimento, e.valor_face.valor]);
      const id = rows[0].id;

      for (const t of e.talhoes) {
        await c.query(
          'INSERT INTO ops.contrato_talhao (contrato_id, talhao_id, sacas_alocadas) VALUES ($1,$2,$3)',
          [id, t.talhao_id, t.sacas_alocadas]);
      }
      await c.query(
        `INSERT INTO ops.contrato_transicao (contrato_id, de, para, guarda, origem, ator_tipo)
         VALUES ($1, NULL, 'RASCUNHO', 'criacao', $2, 'SERVICO')`, [id, ctx.origem]);
      await publicar(c, ctx, {
        tipo: 'contrato.rascunho-criado', sujeitoTipo: 'CONTRATO', sujeitoId: id,
        payload: {
          contrato_id: id, produtor_ref: e.produtor_ref, commodity: e.commodity,
          quantidade_sacas: e.quantidade_sacas, safra: e.safra,
          valor_face: e.valor_face.valor, vencimento: e.vencimento,
        },
      });
      log.info(ctx, 'rascunho criado', { contrato_id: id, registro_id: registroId });
      return { id, registro_id: registroId, estado: 'RASCUNHO' as const };
    });
  }

  /** Registra o título na entidade autorizada. É o registro que dá eficácia. */
  async registrar(ctx: Contexto, contratoId: string) {
    const { rows } = await poolOps().query(
      `SELECT c.*, p.ref_opaca FROM ops.contrato c JOIN ops.produtor p ON p.id = c.produtor_id
        WHERE c.id = $1`, [contratoId]);
    if (!rows.length) throw invalido('contrato inexistente');
    const c0 = rows[0];

    const garantias = await poolOps().query(
      `SELECT tipo, registro_publico_ref, valor_declarado FROM ops.garantia
        WHERE contrato_id = $1 AND liberada_em IS NULL`, [contratoId]);

    const titulo = {
      entidade: c0.registro_entidade,
      registro_id: c0.registro_id,
      estado: 'VIGENTE',
      titular_ref: c0.ref_opaca.toString('hex'),
      emitente_ref: c0.ref_opaca.toString('hex'),
      commodity: c0.commodity,
      quantidade: String(c0.quantidade_sacas),
      valor_face: { valor: String(c0.valor_face), moeda: 'BRL' },
      vencimento: new Date(c0.vencimento).toISOString().slice(0, 10),
      garantias: garantias.rows.map((g: Record<string, unknown>) => ({
        tipo: g.tipo, referencia: g.registro_publico_ref ?? '',
        valor: { valor: String(g.valor_declarado), moeda: 'BRL' },
      })),
      onus: [], cessoes: [],
    };

    const resposta = await comCusto(poolOps(),
      { etapa: 'REGISTRO_CONSULTA', sujeitoTipo: 'CONTRATO', sujeitoId: contratoId,
        automatica: true, tarifaCentavos: 250, fonte: 'registradora' },
      async () => {
        const r = await fetch(`${URL_REGISTRADORA}/sim/titulos`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(titulo),
        });
        if (!r.ok) throw new Error(`registradora respondeu ${r.status}`);
        return r.json() as Promise<{ conteudo_hash: string; atualizado_em: string }>;
      });

    return emTransacao(poolOps(), async (cli) => {
      await cli.query(
        `UPDATE ops.contrato SET estado = 'REGISTRADO', registrado_em = now(),
                registro_documento_hash = decode($2,'hex'), atualizado_em = now()
          WHERE id = $1`, [contratoId, resposta.conteudo_hash.slice(2)]);
      await cli.query(
        `INSERT INTO ops.contrato_transicao (contrato_id, de, para, guarda, origem, ator_tipo, evidencia)
         VALUES ($1,'EM_VERIFICACAO','REGISTRADO','registro_confirmado_pela_entidade',$2,'SERVICO',$3)`,
        [contratoId, ctx.origem, JSON.stringify([{ tipo: 'SNAPSHOT_REGISTRO', hash: resposta.conteudo_hash }])]);
      await publicar(cli, ctx, {
        tipo: 'contrato.registrado', sujeitoTipo: 'CONTRATO', sujeitoId: contratoId,
        payload: {
          contrato_id: contratoId, registro_entidade: c0.registro_entidade,
          registro_hash_ancora: '0x' + c0.registro_hash_ancora.toString('hex'),
          registro_documento_hash: resposta.conteudo_hash,
          registrado_em: new Date().toISOString(),
        },
        evidencia: [{ tipo: 'SNAPSHOT_REGISTRO', hash: resposta.conteudo_hash }],
      });
      return { contrato_id: contratoId, estado: 'REGISTRADO', conteudo_hash: resposta.conteudo_hash };
    });
  }

  /** Transição intermediária de verificação, exigida pela máquina de estados. */
  async enviarParaVerificacao(ctx: Contexto, contratoId: string) {
    await poolOps().query(
      `INSERT INTO ops.contrato_transicao (contrato_id, de, para, guarda, origem, ator_tipo)
       VALUES ($1,'RASCUNHO','EM_VERIFICACAO','dados_minimos_preenchidos',$2,'SERVICO')`,
      [contratoId, ctx.origem]);
    await poolOps().query("UPDATE ops.contrato SET estado='EM_VERIFICACAO' WHERE id=$1", [contratoId]);
  }

  /**
   * Emite o espelho. Idempotente por âncora (P3): a segunda chamada devolve o
   * espelho existente em vez de emitir um segundo token — e mesmo que o
   * backend falhasse, o contrato on-chain reverteria.
   */
  async espelhar(ctx: Contexto, contratoId: string, titularEndereco: string) {
    const { rows } = await poolOps().query(
      'SELECT * FROM ops.contrato WHERE id = $1', [contratoId]);
    if (!rows.length) throw invalido('contrato inexistente');
    const c0 = rows[0];
    if (c0.estado !== 'REGISTRADO') throw invalido(`contrato em ${c0.estado}; espelho exige REGISTRADO`);
    if (c0.token_id) {
      return { ja_existia: true, token_id: String(c0.token_id), chain_id: c0.token_chain_id };
    }

    const ancora = '0x' + c0.registro_hash_ancora.toString('hex');
    const espelho = this.chain.espelho();
    const emUso = await espelho.tokenDaAncora(ancora);
    if (emUso !== 0n) throw ancoraEmUso(ancora);

    const slot = BigInt('0x' + c0.registro_hash_ancora.toString('hex').slice(0, 12));
    const valor = BigInt(Math.round(Number(c0.quantidade_sacas) * 10_000));
    const tx = await espelho.emitirEspelho(
      ancora, titularEndereco, slot, valor, '0x' + c0.registro_documento_hash.toString('hex'));
    const recibo = await tx.wait();
    const tokenId = await espelho.tokenDaAncora(ancora);

    return emTransacao(poolOps(), async (cli) => {
      await cli.query(
        `UPDATE ops.contrato
            SET estado='ESPELHADO', situacao_conciliacao='PENDENTE',
                token_chain_id=$2, token_contrato_addr=decode($3,'hex'), token_id=$4, token_slot=$5,
                espelhado_em=now(), espelhado_tx=decode($6,'hex'), credor_ref=$7, atualizado_em=now()
          WHERE id=$1`,
        [contratoId, this.chain.cfg.chainId, (await espelho.getAddress()).slice(2).toLowerCase(),
         tokenId.toString(), slot.toString(), recibo.hash.slice(2),
         Buffer.from(titularEndereco.slice(2).padEnd(32, '0').slice(0, 32), 'hex')]);
      await cli.query(
        `INSERT INTO ops.contrato_transicao (contrato_id, de, para, guarda, origem, ator_tipo, evidencia)
         VALUES ($1,'REGISTRADO','ESPELHADO','ancora_unica_e_emissao_confirmada',$2,'SERVICO',$3)`,
        [contratoId, ctx.origem, JSON.stringify([{ tipo: 'TRANSACAO', hash: recibo.hash }])]);
      await publicar(cli, ctx, {
        tipo: 'contrato.espelhado', sujeitoTipo: 'CONTRATO', sujeitoId: contratoId,
        payload: {
          contrato_id: contratoId, chain_id: this.chain.cfg.chainId,
          contrato_addr: await espelho.getAddress(), token_id: tokenId.toString(),
          slot: slot.toString(), tx: recibo.hash,
        },
        evidencia: [{ tipo: 'TRANSACAO', hash: recibo.hash }],
      });
      log.info(ctx, 'espelho emitido', { contrato_id: contratoId, token_id: tokenId.toString() });
      return { ja_existia: false, token_id: tokenId.toString(), chain_id: this.chain.cfg.chainId, tx: recibo.hash };
    });
  }

  get cadeiaPublica(): Cadeia { return this.chain; }
}
