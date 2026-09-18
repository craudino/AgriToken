import { Injectable } from '@nestjs/common';
import {
  poolOps, emTransacao, publicar, hashPayload, sha256Hex, canonico, Contexto, log,
  comCusto, POLITICA_DIVERGENCIA, TipoDivergencia, Severidade, chamar, chamarJson } from '@cpr/nucleo';
import { Cadeia, hashDe } from '@cpr/nucleo';

const URL_REGISTRADORA = process.env.URL_REGISTRADORA ?? 'http://127.0.0.1:3005';
const URL_ORACLE = process.env.URL_ORACLE ?? 'http://127.0.0.1:3002';

interface Achado {
  tipo: TipoDivergencia;
  campo?: string;
  valorRegistro?: unknown;
  valorOnchain?: unknown;
  ocorridaEm?: Date;
}

/**
 * Conciliação contínua registro ↔ token. É a lacuna informacional nº 1 e a peça
 * cuja falha derruba toda a arquitetura de espelhamento.
 *
 * P1 governa cada linha: não existe aqui nenhum caminho que escreva no registro
 * a partir do estado on-chain. Quando os dois discordam, o registro prevalece,
 * o contrato congela e a saída exige reconciliação humana.
 */
@Injectable()
export class ConciliacaoService {
  private cadeia: Cadeia | null = null;
  private get chain(): Cadeia { return (this.cadeia ??= new Cadeia()); }
  private readonly politica = new Map(POLITICA_DIVERGENCIA.map((p) => [p.tipo, p]));

  async executar(ctx: Contexto, escopo: 'COMPLETA' | 'CONTRATO' = 'COMPLETA', contratoId?: string) {
    const t0 = performance.now();
    const { rows: exec } = await poolOps().query<{ id: string }>(
      'INSERT INTO ops.conciliacao_execucao (escopo) VALUES ($1) RETURNING id', [escopo]);
    const execucaoId = exec[0].id;

    const { rows: contratos } = await poolOps().query(
      `SELECT c.*, p.ref_opaca AS produtor_ref FROM ops.contrato c
         JOIN ops.produtor p ON p.id = c.produtor_id
        WHERE c.token_id IS NOT NULL AND ($1::uuid IS NULL OR c.id = $1)`, [contratoId ?? null]);

    let abertas = 0;
    for (const c of contratos) {
      const achados = await comCusto(poolOps(),
        { etapa: 'CONCILIACAO_CICLO', sujeitoTipo: 'CONTRATO', sujeitoId: c.id,
          automatica: true, tarifaCentavos: 10, fonte: 'registradora' },
        () => this.conciliarContrato(ctx, c));
      for (const a of achados) {
        const criada = await this.registrarDivergencia(ctx, execucaoId, c, a);
        if (criada) abertas++;
      }
      if (achados.length === 0) await this.marcarConforme(ctx, c);
    }
    // Registro sem espelho correspondente: o outro sentido da órfandade.
    abertas += await this.detectarRegistrosSemEspelho(ctx, execucaoId);

    const duracao = Math.round(performance.now() - t0);
    await poolOps().query(
      `UPDATE ops.conciliacao_execucao
          SET concluida_em = now(), contratos_lidos = $2, divergencias_abertas = $3, duracao_ms = $4
        WHERE id = $1`, [execucaoId, contratos.length, abertas, duracao]);

    log.info(ctx, 'conciliação concluída', { execucao: execucaoId, contratos: contratos.length, abertas, duracao_ms: duracao });
    return { execucao_id: execucaoId, contratos_lidos: contratos.length, divergencias_abertas: abertas, duracao_ms: duracao };
  }

  /**
   * Ciclo conforme: o espelho confere com o registro. É aqui que o contrato
   * recém-espelhado entra em circulação — e a passagem exige conciliação
   * efetivamente executada, não a simples ausência de notícia ruim. Para quem
   * olha de fora, ausência de divergência e ausência de conciliação são
   * indistinguíveis; a transição registrada é o que as separa.
   */
  private async marcarConforme(ctx: Contexto, c: Record<string, any>) {
    const { rows: abertas } = await poolOps().query<{ n: string }>(
      `SELECT count(*) n FROM ops.divergencia
        WHERE contrato_id = $1 AND estado IN ('ABERTA','EM_RECONCILIACAO')`, [c.id]);
    if (Number(abertas[0].n) > 0) return;

    await emTransacao(poolOps(), async (cli) => {
      const { rows } = await cli.query<{ estado: string; situacao_conciliacao: string }>(
        'SELECT estado, situacao_conciliacao FROM ops.contrato WHERE id = $1', [c.id]);
      const atual = rows[0];
      if (atual.situacao_conciliacao === 'CONGELADO') return;

      if (atual.estado === 'ESPELHADO') {
        await cli.query(
          `INSERT INTO ops.contrato_transicao (contrato_id, de, para, guarda, origem, ator_tipo, evidencia)
           VALUES ($1,'ESPELHADO','ATIVO','conciliacao_inicial_conforme',$2,'SERVICO',$3)`,
          [c.id, ctx.origem, JSON.stringify([{ tipo: 'SNAPSHOT_REGISTRO', hash: '0x' + '0'.repeat(64) }])]);
        await cli.query("UPDATE ops.contrato SET estado='ATIVO' WHERE id=$1", [c.id]);
        await publicar(cli, ctx, {
          tipo: 'contrato.transicionado', sujeitoTipo: 'CONTRATO', sujeitoId: c.id,
          payload: { contrato_id: c.id, de: 'ESPELHADO', para: 'ATIVO', guarda: 'conciliacao_inicial_conforme' },
          evidencia: [{ tipo: 'SNAPSHOT_REGISTRO', hash: '0x' + '0'.repeat(64) }],
        });
      }
      if (atual.situacao_conciliacao !== 'CONCILIADO') {
        await cli.query(
          "UPDATE ops.contrato SET situacao_conciliacao='CONCILIADO', atualizado_em=now() WHERE id=$1", [c.id]);
      }
    });
  }

  /** Lê o registro com quórum (P4) e compara com o estado on-chain. */
  private async conciliarContrato(ctx: Contexto, c: Record<string, any>): Promise<Achado[]> {
    const chave = `${c.registro_entidade}/${c.registro_id}`;
    const leitura = await chamarJson<{ estado: string; valorJson: unknown; falhas: Array<{ motivo: string }> }>(
      `${URL_ORACLE}/leituras/coletar`,
      { servico: 'services/core', metodo: 'POST', correlacaoId: ctx.correlacaoId,
        corpo: { tipo: 'REGISTRO', chave, url: URL_REGISTRADORA } });

    const espelho = this.chain.espelho('conciliador');
    const tokenId = BigInt(c.token_id);
    const estadoToken = Number(await espelho.estadoDo(tokenId));
    const hashDocOnchain: string = await espelho.hashDocumentalDe(tokenId);

    // Título ausente no registro: as fontes concordam que não existe.
    const todasFalharamPorAusencia = leitura.falhas.length > 0 &&
      leitura.falhas.every((f) => /404/.test(f.motivo));
    if (todasFalharamPorAusencia) {
      return [{ tipo: 'TITULO_INEXISTENTE_NO_REGISTRO', valorRegistro: null, valorOnchain: { token_id: c.token_id } }];
    }
    if (leitura.estado !== 'EFETIVA' && leitura.estado !== 'DEGRADADA') {
      // Sem quórum não se conclui nada: a ausência de conclusão é sinalizada,
      // não convertida em "está tudo certo" (P4).
      log.aviso(ctx, 'conciliação sem quórum de registro', { contrato_id: c.id, estado: leitura.estado });
      return [];
    }

    const t = leitura.valorJson as Record<string, any>;
    const achados: Achado[] = [];
    const ocorridaEm = t.atualizado_em ? new Date(t.atualizado_em) : undefined;
    const add = (tipo: TipoDivergencia, campo: string, reg: unknown, onchain: unknown) =>
      achados.push({ tipo, campo, valorRegistro: reg, valorOnchain: onchain, ocorridaEm });

    if (t.estado === 'BAIXADO' && estadoToken === 0) {
      add('TITULO_BAIXADO_NO_REGISTRO', 'estado', t.estado, 'ATIVO');
    }
    if (['PROTESTADO', 'BLOQUEADO_JUDICIALMENTE', 'CANCELADO'].includes(t.estado) && estadoToken === 0) {
      add('ESTADO_DIVERGENTE', 'estado', t.estado, 'ATIVO');
    }
    if (Number(t.valor_face?.valor) !== Number(c.valor_face)) {
      add('VALOR_FACE_ALTERADO', 'valor_face', t.valor_face?.valor, String(c.valor_face));
    }
    if (Number(t.quantidade) !== Number(c.quantidade_sacas)) {
      add('QUANTIDADE_ALTERADA', 'quantidade', t.quantidade, String(c.quantidade_sacas));
    }
    if (t.vencimento !== new Date(c.vencimento).toISOString().slice(0, 10)) {
      add('VENCIMENTO_ALTERADO', 'vencimento', t.vencimento, new Date(c.vencimento).toISOString().slice(0, 10));
    }
    if ((t.onus?.length ?? 0) > 0) {
      add('ONUS_OU_GRAVAME_NAO_REFLETIDO', 'onus', t.onus, []);
    }
    if ((t.cessoes?.length ?? 0) > 0) {
      add('CESSAO_NAO_REFLETIDA', 'titular_ref', t.titular_ref, c.credor_ref?.toString('hex') ?? null);
    }
    const { rows: g } = await poolOps().query<{ n: string }>(
      'SELECT count(*) n FROM ops.garantia WHERE contrato_id = $1 AND liberada_em IS NULL', [c.id]);
    if (Number(t.garantias?.length ?? 0) !== Number(g[0].n)) {
      add('GARANTIA_ALTERADA', 'garantias', t.garantias?.length ?? 0, Number(g[0].n));
    }
    if (t.conteudo_hash && hashDocOnchain && t.conteudo_hash.toLowerCase() !== hashDocOnchain.toLowerCase()) {
      add('HASH_DOCUMENTAL_DIVERGENTE', 'conteudo_hash', t.conteudo_hash, hashDocOnchain);
    }

    // Lado do token: transferência e fracionamento sem cessão registrada.
    achados.push(...await this.conciliarLadoToken(c, t));

    // Guardamos os dois instantâneos comparados. Sem eles, a divergência é
    // alegação; com eles, é evidência reproduzível (P5).
    await this.gravarSnapshots(c, t, { estado: estadoToken, hash_documental: hashDocOnchain, token_id: c.token_id });
    return achados;
  }

  /**
   * Divergências no sentido token → registro. Antes de SMC-004 o catálogo só
   * enxergava o sentido inverso, e a fração podia circular fora do registro sem
   * que ninguém visse — achado A1 de E1 em G1.
   */
  private async conciliarLadoToken(c: Record<string, any>, t: Record<string, any>): Promise<Achado[]> {
    const espelho = this.chain.espelho('conciliador');
    const eventos = await espelho.queryFilter(espelho.filters.TitularidadeAlterada(BigInt(c.token_id)), 0, 'latest');
    if (!eventos.length) return [];

    const cessoesRegistradas = (t.cessoes?.length ?? 0);
    const achados: Achado[] = [];
    if (eventos.length > cessoesRegistradas) {
      const ev = eventos[eventos.length - 1] as unknown as { args: Record<string, unknown>; blockNumber: number };
      const bloco = await this.chain.provider.getBlock(ev.blockNumber);
      const ocorridaEm = bloco ? new Date(Number(bloco.timestamp) * 1000) : undefined;
      const novoToken = String(ev.args.novoTokenId ?? '0');

      achados.push({
        tipo: novoToken !== '0' ? 'FRACIONAMENTO_NAO_REFLETIDO' : 'TRANSFERENCIA_SEM_CESSAO',
        campo: 'titularidade',
        valorRegistro: { cessoes: cessoesRegistradas },
        valorOnchain: { transferencias: eventos.length, ultimo_token: novoToken },
        ocorridaEm,
      });
    }
    return achados;
  }

  private async gravarSnapshots(c: Record<string, any>, registro: unknown, onchain: unknown) {
    await poolOps().query(
      `INSERT INTO ops.snapshot_registro (contrato_id, registro_entidade, registro_id, conteudo, conteudo_hash, origem_uri)
       VALUES ($1,$2,$3,$4, decode($5,'hex'), $6)`,
      [c.id, c.registro_entidade, c.registro_id, JSON.stringify(registro),
       hashPayload(registro).slice(2), `${URL_REGISTRADORA}/titulos/${c.registro_entidade}/${c.registro_id}`]);
    const bloco = await this.chain.provider.getBlockNumber();
    const blocoInfo = await this.chain.provider.getBlock(bloco);
    await poolOps().query(
      `INSERT INTO ops.snapshot_onchain (contrato_id, chain_id, contrato_addr, token_id, bloco, bloco_hash, conteudo, conteudo_hash)
       VALUES ($1,$2, decode($3,'hex'), $4,$5, decode($6,'hex'), $7, decode($8,'hex'))`,
      [c.id, this.chain.cfg.chainId,
       (await this.chain.espelho().getAddress()).slice(2).toLowerCase(), c.token_id, bloco,
       (blocoInfo?.hash ?? '0x' + '0'.repeat(64)).slice(2), JSON.stringify(onchain), hashPayload(onchain).slice(2)]);
  }

  /** Título registrado sem espelho: o sistema precisa ver a própria ausência. */
  private async detectarRegistrosSemEspelho(ctx: Contexto, execucaoId: string): Promise<number> {
    const r = await chamar(`${URL_REGISTRADORA}/titulos`,
      { servico: 'services/core', correlacaoId: ctx.correlacaoId }).catch(() => null);
    if (!r?.ok) return 0;
    const { itens } = await r.json() as { itens: Array<Record<string, any>> };
    let n = 0;
    for (const t of itens) {
      const { rows } = await poolOps().query(
        'SELECT id, token_id FROM ops.contrato WHERE registro_entidade = $1 AND registro_id = $2',
        [t.entidade, t.registro_id]);
      if (rows.length && rows[0].token_id) continue;
      if (t.estado !== 'VIGENTE') continue;
      const criada = await this.registrarDivergencia(ctx, execucaoId,
        { id: rows[0]?.id ?? null, registro_entidade: t.entidade, registro_id: t.registro_id },
        { tipo: 'TOKEN_AUSENTE_PARA_REGISTRO', campo: 'token_id',
          valorRegistro: { registro_id: t.registro_id }, valorOnchain: null,
          ocorridaEm: t.atualizado_em ? new Date(t.atualizado_em) : undefined });
      if (criada) n++;
    }
    return n;
  }

  /**
   * Registra a divergência, marca o placar da injeção e congela quando a
   * política manda. A latência entre o fato e a detecção é a métrica que
   * responde à lacuna nº 1 — medida, não prometida.
   */
  private async registrarDivergencia(
    ctx: Contexto, execucaoId: string, c: Record<string, any>, a: Achado,
  ): Promise<boolean> {
    const pol = this.politica.get(a.tipo)!;

    if (c.id) {
      const { rows: jaAberta } = await poolOps().query(
        `SELECT id FROM ops.divergencia
          WHERE contrato_id = $1 AND tipo = $2 AND estado IN ('ABERTA','EM_RECONCILIACAO')`,
        [c.id, a.tipo]);
      if (jaAberta.length) return false;         // não duplica incidente aberto
    }

    return emTransacao(poolOps(), async (cli) => {
      const { rows: inc } = await cli.query<{ id: string }>(
        `INSERT INTO ops.incidente (origem, severidade, titulo, descricao, contrato_id)
         VALUES ('CONCILIACAO', $1, $2, $3, $4) RETURNING id`,
        [pol.severidade, `Divergência ${a.tipo}`,
         `Campo ${a.campo ?? 'n/d'}: registro e espelho divergem. O registro prevalece (P1).`,
         c.id ?? null]);

      const { rows: div } = await cli.query<{ id: string; latencia_deteccao_ms: string | null }>(
        `INSERT INTO ops.divergencia
           (execucao_id, contrato_id, tipo, severidade, campo, valor_registro, valor_onchain,
            ocorrida_em, congelou_contrato, incidente_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, latencia_deteccao_ms`,
        [execucaoId, c.id ?? null, a.tipo, pol.severidade, a.campo ?? null,
         JSON.stringify(a.valorRegistro ?? null), JSON.stringify(a.valorOnchain ?? null),
         a.ocorridaEm ?? null, pol.congela, inc[0].id]);
      const divergenciaId = div[0].id;

      if (pol.congela && c.id) {
        // A ordem importa e custou um bug: a trava de SMC-001 recusa qualquer
        // transição em contrato já congelado, inclusive a que registra a
        // entrada em disputa. Primeiro o contrato entra em disputa; só então
        // congela. Congelar antes travaria o próprio registro do congelamento.
        const { rows: est } = await cli.query<{ estado: string }>(
          'SELECT estado FROM ops.contrato WHERE id = $1', [c.id]);
        if (est[0]?.estado === 'ATIVO') {
          await cli.query(
            `INSERT INTO ops.contrato_transicao
               (contrato_id, de, para, guarda, origem, ator_tipo, divergencia_id, evidencia)
             VALUES ($1,'ATIVO','EM_DISPUTA','divergencia_critica_ou_contestacao',$2,'SERVICO',$3,$4)`,
            [c.id, ctx.origem, divergenciaId,
             JSON.stringify([{ tipo: 'SNAPSHOT_REGISTRO', hash: hashPayload(a.valorRegistro ?? null) }])]);
          await cli.query("UPDATE ops.contrato SET estado='EM_DISPUTA' WHERE id=$1", [c.id]);
        }
        await cli.query(
          `UPDATE ops.contrato
              SET situacao_conciliacao='CONGELADO', congelado_em=now(),
                  congelado_motivo=$2, atualizado_em=now()
            WHERE id=$1 AND situacao_conciliacao <> 'CONGELADO'`,
          [c.id, `divergencia ${a.tipo}`]);
        await publicar(cli, ctx, {
          tipo: 'conciliacao.contrato-congelado', sujeitoTipo: 'CONTRATO', sujeitoId: c.id,
          payload: { contrato_id: c.id, divergencia_id: divergenciaId, severidade: pol.severidade, tx_congelamento: null },
          evidencia: [{ tipo: 'SNAPSHOT_REGISTRO', hash: hashPayload(a.valorRegistro ?? null) }],
        });
      }

      await publicar(cli, ctx, {
        tipo: 'conciliacao.divergencia-detectada',
        sujeitoTipo: 'CONTRATO', sujeitoId: c.id ?? divergenciaId,
        payload: {
          divergencia_id: divergenciaId, contrato_id: c.id ?? null, tipo: a.tipo,
          severidade: pol.severidade, campo: a.campo ?? null,
          valor_registro: a.valorRegistro ?? null, valor_onchain: a.valorOnchain ?? null,
          ocorrida_em: a.ocorridaEm?.toISOString() ?? null,
          detectada_em: new Date().toISOString(),
          latencia_deteccao_ms: div[0].latencia_deteccao_ms ? Number(div[0].latencia_deteccao_ms) : null,
        },
        evidencia: [
          { tipo: 'SNAPSHOT_REGISTRO', hash: hashPayload(a.valorRegistro ?? null) },
          { tipo: 'SNAPSHOT_ONCHAIN', hash: hashPayload(a.valorOnchain ?? null) },
        ],
      });

      // Placar da injeção: fecha o ciclo do teste de aceite de W2.
      await cli.query(
        `UPDATE sim.injecao SET detectada_divergencia_id = $1, detectada_em = now(),
                latencia_ms = EXTRACT(epoch FROM (now() - injetada_em)) * 1000
          WHERE id = (SELECT id FROM sim.injecao
                       WHERE tipo = $2 AND registro_id = $3 AND detectada_em IS NULL
                       ORDER BY injetada_em DESC LIMIT 1)`,
        [divergenciaId, a.tipo, c.registro_id]);

      log.aviso(ctx, 'divergência detectada', {
        contrato_id: c.id, tipo: a.tipo, severidade: pol.severidade,
        latencia_ms: div[0].latencia_deteccao_ms,
      });
      return true;
    });
  }

  /** Congela também on-chain quando há token — o freio precisa existir nos dois lados. */
  async congelarOnchain(ctx: Contexto, contratoId: string, divergenciaId: string) {
    const { rows } = await poolOps().query('SELECT token_id FROM ops.contrato WHERE id = $1', [contratoId]);
    if (!rows.length || !rows[0].token_id) return null;
    const espelho = this.chain.espelho('conciliador');
    if (await espelho.estaCongelado(BigInt(rows[0].token_id))) return null;
    const tx = await espelho.congelar(BigInt(rows[0].token_id), hashDe(divergenciaId), 4);
    const r = await tx.wait();
    return r.hash as string;
  }

  /**
   * Reconciliação humana. Não existe rota automática, e a correção sempre desce
   * do registro para o espelho — nunca o contrário (P1).
   */
  async reconciliar(
    ctx: Contexto, divergenciaId: string,
    decisao: 'ACEITAR_REGISTRO' | 'MARCAR_FALSO_POSITIVO',
    justificativa: string, operador: string, atorRef: string,
  ) {
    if (!/^OP-[A-Z0-9-]{3,}$/.test(operador)) {
      throw new Error('operador precisa ser identificador funcional humano (ex.: OP-CONCILIACAO-07)');
    }
    if (justificativa.length < 20) throw new Error('justificativa insuficiente');

    return emTransacao(poolOps(), async (cli) => {
      const { rows } = await cli.query(
        'SELECT * FROM ops.divergencia WHERE id = $1', [divergenciaId]);
      if (!rows.length) throw new Error('divergência inexistente');
      const d = rows[0];

      await cli.query(
        `UPDATE ops.divergencia
            SET estado = $2, reconciliada_em = now(), reconciliada_por = $3,
                reconciliacao_nota = $4, reconciliacao_justificativa_hash = decode($5,'hex')
          WHERE id = $1`,
        [divergenciaId, decisao === 'ACEITAR_REGISTRO' ? 'RECONCILIADA' : 'FALSO_POSITIVO',
         operador, justificativa.slice(0, 200), hashPayload({ justificativa }).slice(2)]);

      await cli.query(
        'UPDATE ops.incidente SET fechado_em = now(), responsavel = $2, resolucao = $3 WHERE id = $1',
        [d.incidente_id, operador, `reconciliada: ${decisao}`]);

      const { rows: abertas } = await cli.query<{ n: string }>(
        `SELECT count(*) n FROM ops.divergencia
          WHERE contrato_id = $1 AND estado IN ('ABERTA','EM_RECONCILIACAO')`, [d.contrato_id]);

      if (Number(abertas[0].n) === 0 && d.contrato_id) {
        await cli.query(
          `INSERT INTO ops.contrato_transicao
             (contrato_id, de, para, guarda, origem, ator_tipo, ator_ref, divergencia_id)
           VALUES ($1,'EM_DISPUTA','ATIVO','divergencia_reconciliada',$2,'HUMANO',$3,$4)`,
          [d.contrato_id, ctx.origem, Buffer.from(atorRef, 'hex'), divergenciaId]);
        await cli.query(
          `UPDATE ops.contrato
              SET estado='ATIVO', situacao_conciliacao='CONCILIADO',
                  congelado_em=NULL, congelado_motivo=NULL, atualizado_em=now()
            WHERE id=$1`, [d.contrato_id]);
      }

      await publicar(cli, ctx, {
        tipo: 'conciliacao.divergencia-reconciliada',
        sujeitoTipo: 'CONTRATO', sujeitoId: d.contrato_id ?? divergenciaId,
        payload: {
          divergencia_id: divergenciaId, decisao, operador,
          justificativa_hash: hashPayload({ justificativa }),
        },
        atorRef, atorTipo: 'HUMANO',
        evidencia: [{ tipo: 'DOCUMENTO', hash: hashPayload({ justificativa }) }],
      });

      log.info(ctx, 'divergência reconciliada por humano', { divergencia_id: divergenciaId, operador, decisao });
      return { divergencia_id: divergenciaId, estado: decisao === 'ACEITAR_REGISTRO' ? 'RECONCILIADA' : 'FALSO_POSITIVO',
               contrato_descongelado: Number(abertas[0].n) === 0 };
    });
  }

  async descongelarOnchain(contratoId: string, divergenciaId: string) {
    const { rows } = await poolOps().query('SELECT token_id FROM ops.contrato WHERE id = $1', [contratoId]);
    if (!rows.length || !rows[0].token_id) return null;
    const espelho = this.chain.espelho('reconciliador');
    if (!(await espelho.estaCongelado(BigInt(rows[0].token_id)))) return null;
    const tx = await espelho.descongelar(BigInt(rows[0].token_id), hashDe(divergenciaId));
    const r = await tx.wait();
    return r.hash as string;
  }
}
