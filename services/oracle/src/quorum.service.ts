import { Injectable } from '@nestjs/common';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  poolOps, emTransacao, publicar, sha256Hex, canonico, hashPayload,
  Contexto, log, comCusto, semQuorum, TipoLeitura, EstadoLeitura,
} from '@cpr/nucleo';
import * as fontes from './fontes';

interface Politica {
  tipo_leitura: TipoLeitura;
  criticidade: 'INFORMATIVA' | 'CONTRATUAL';
  min_fontes: number;
  min_fontes_independentes: number;
  desvio_max_pct: string;
  janela_validade: string;
  agregacao: 'MEDIANA' | 'MEDIA_PONDERADA' | 'UNANIMIDADE' | 'INTERSECAO';
  permite_degradado: boolean;
}

const DIR_BRUTO = process.env.DIR_BRUTO ?? '/var/lib/cpr-bruto';

@Injectable()
export class QuorumService {
  constructor() { mkdirSync(DIR_BRUTO, { recursive: true }); }

  private async politica(tipo: TipoLeitura): Promise<Politica> {
    const { rows } = await poolOps().query<Politica>(
      'SELECT * FROM ops.politica_quorum WHERE tipo_leitura = $1', [tipo]);
    return rows[0];
  }

  private async fontesDe(tipo: TipoLeitura) {
    const { rows } = await poolOps().query<{ id: string; codigo: string; peso: string; independente_de: string[] }>(
      'SELECT id, codigo, peso, independente_de FROM ops.fonte_oraculo WHERE tipo_leitura = $1 AND ativa',
      [tipo]);
    return rows;
  }

  /**
   * Conta fontes independentes descontando correlação declarada. Dois
   * agregadores que republicam o mesmo boletim parecem duas fontes e são uma —
   * e redundância aparente é pior que ausência de redundância, porque induz
   * confiança injustificada (ADR-0003).
   */
  contarIndependentes(
    usadas: string[],
    correlacao: Map<string, string[]>,
  ): number {
    const grupos: string[][] = [];
    for (const f of usadas) {
      const relacionadas = correlacao.get(f) ?? [];
      const grupo = grupos.find((g) => g.some((x) => relacionadas.includes(x) || (correlacao.get(x) ?? []).includes(f)));
      if (grupo) grupo.push(f); else grupos.push([f]);
    }
    return grupos.length;
  }

  private arquivarBruto(bruto: unknown): { hash: string; uri: string } {
    const hash = sha256Hex(canonico(bruto));
    const caminho = join(DIR_BRUTO, `${hash.slice(2)}.json`);
    writeFileSync(caminho, JSON.stringify(bruto, null, 2));
    return { hash, uri: `arquivo://${caminho}` };
  }

  private mediana(valores: number[]): number {
    const s = [...valores].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /**
   * Coleta, agrega e persiste. Quando o quórum não fecha, grava a leitura em
   * SEM_QUORUM e devolve erro: o sistema sinaliza a ausência em vez de produzir
   * um número plausível de fonte única (P4).
   */
  async coletar(ctx: Contexto, tipo: TipoLeitura, chave: string, opcoes: { url?: string } = {}) {
    const pol = await this.politica(tipo);
    const cadastradas = await this.fontesDe(tipo);
    const correlacao = new Map(cadastradas.map((f) => [f.codigo, f.independente_de ?? []]));

    const coletadas: Array<fontes.Leitura & { fonteId: string }> = [];
    const falhas: Array<{ fonte: string; motivo: string }> = [];

    for (const f of cadastradas) {
      try {
        const l = await comCusto(poolOps(),
          { etapa: tipo === 'PRECO' ? 'PRECO_COLETA' : tipo === 'PAGAMENTO' ? 'PAGAMENTO_CONFIRMACAO' : 'REGISTRO_CONSULTA',
            sujeitoTipo: 'PLATAFORMA', sujeitoId: '00000000-0000-4000-8000-000000000000',
            automatica: true, tarifaCentavos: 5, fonte: f.codigo },
          () => this.lerFonte(tipo, f.codigo, chave, opcoes.url));
        coletadas.push({ ...l, fonteId: f.id });
      } catch (e) {
        falhas.push({ fonte: f.codigo, motivo: (e as Error).message });
      }
    }

    const independentes = this.contarIndependentes(coletadas.map((c) => c.fonte), correlacao);
    const numericas = coletadas.map((c) => Number(c.valorNumerico)).filter((n) => !Number.isNaN(n));

    let estado: EstadoLeitura = 'SEM_QUORUM';
    let valorNumerico: string | null = null;
    let valorJson: unknown = null;
    let dispersao: number | null = null;

    if (independentes >= pol.min_fontes_independentes) {
      if (numericas.length) {
        const agregado = pol.agregacao === 'MEDIANA' ? this.mediana(numericas)
          : numericas.reduce((a, b) => a + b, 0) / numericas.length;
        const menor = Math.min(...numericas), maior = Math.max(...numericas);
        dispersao = agregado ? ((maior - menor) / agregado) * 100 : 0;
        if (dispersao > Number(pol.desvio_max_pct)) {
          // Dispersão acima da tolerância não é média: é sinal de que as fontes
          // discordam, e discordância não se resolve tirando média.
          estado = 'SEM_QUORUM';
        } else {
          valorNumerico = agregado.toFixed(8);
          estado = coletadas.length >= pol.min_fontes ? 'EFETIVA'
                 : pol.permite_degradado ? 'DEGRADADA' : 'SEM_QUORUM';
        }
      } else {
        const jsons = coletadas.map((c) => canonico(c.valorJson));
        const unanime = jsons.every((j) => j === jsons[0]);
        if (pol.agregacao === 'UNANIMIDADE' && !unanime) {
          estado = 'SEM_QUORUM';         // fato binário: discordar é não saber
        } else if (pol.agregacao === 'INTERSECAO') {
          // Conformidade: se uma base aponta problema, o resultado não é conforme.
          const resultados = coletadas.map((c) => (c.valorJson as { resultado?: string })?.resultado);
          const pior = resultados.includes('NAO_CONFORME') ? 'NAO_CONFORME'
            : resultados.includes('LIMITROFE') ? 'LIMITROFE'
            : resultados.includes('INCONCLUSIVO') ? 'INCONCLUSIVO' : 'CONFORME';
          valorJson = { resultado: pior, por_fonte: coletadas.map((c) => ({ fonte: c.fonte, ...(c.valorJson as object) })) };
          estado = coletadas.length >= pol.min_fontes ? 'EFETIVA' : 'SEM_QUORUM';
        } else {
          valorJson = coletadas[0]?.valorJson ?? null;
          estado = coletadas.length >= pol.min_fontes ? 'EFETIVA'
                 : pol.permite_degradado ? 'DEGRADADA' : 'SEM_QUORUM';
        }
      }
    }

    const linhagem = hashPayload({
      chave, politica: pol,
      fontes: coletadas.map((c) => ({ fonte: c.fonte, bruto: c.bruto })),
      falhas,
    });

    const id = await emTransacao(poolOps(), async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO ops.leitura_oraculo
           (tipo_leitura, chave, valor_numerico, valor_json, unidade, referencia_em, expira_em,
            estado, fontes_usadas, fontes_independentes, dispersao_pct, politica_snapshot, hash_linhagem)
         VALUES ($1,$2,$3,$4,$5, now(), now() + $6::interval, $7,$8,$9,$10,$11, decode($12,'hex'))
         RETURNING id`,
        [tipo, chave, valorNumerico, valorJson ? JSON.stringify(valorJson) : null,
         tipo === 'PRECO' ? 'BRL/saca' : null, pol.janela_validade, estado,
         coletadas.length, independentes, dispersao, JSON.stringify(pol), linhagem.slice(2)]);
      const leituraId = rows[0].id;

      for (const l of coletadas) {
        const { hash, uri } = this.arquivarBruto(l.bruto);
        await c.query(
          `INSERT INTO ops.leitura_fonte
             (leitura_id, fonte_id, valor_numerico, valor_json, bruto_hash, bruto_uri, latencia_ms)
           VALUES ($1,$2,$3,$4, decode($5,'hex'), $6, $7)`,
          [leituraId, l.fonteId, l.valorNumerico ?? null,
           l.valorJson ? JSON.stringify(l.valorJson) : null, hash.slice(2), uri, Math.round(l.latenciaMs)]);
      }
      // Fonte que falhou também é linhagem: o que foi descartado importa tanto
      // quanto o que foi usado, e sem isso ninguém sabe que a fonte caiu.
      for (const f of falhas) {
        const fonte = cadastradas.find((x) => x.codigo === f.fonte);
        if (!fonte) continue;
        const { hash, uri } = this.arquivarBruto({ fonte: f.fonte, falha: f.motivo });
        await c.query(
          `INSERT INTO ops.leitura_fonte
             (leitura_id, fonte_id, bruto_hash, bruto_uri, descartada, motivo_descarte)
           VALUES ($1,$2, decode($3,'hex'), $4, true, $5)`,
          [leituraId, fonte.id, hash.slice(2), uri, f.motivo]);
      }

      if (estado === 'EFETIVA' || estado === 'DEGRADADA') {
        await publicar(c, ctx, {
          tipo: 'oraculo.leitura-efetivada', sujeitoTipo: 'LEITURA', sujeitoId: leituraId,
          payload: {
            leitura_id: leituraId, tipo, chave, valor: valorNumerico, estado,
            fontes_usadas: coletadas.length, fontes_independentes: independentes,
            dispersao_pct: dispersao, hash_linhagem: linhagem,
          },
          evidencia: coletadas.map((l) => ({ tipo: 'LEITURA_ORACULO', hash: sha256Hex(canonico(l.bruto)) })),
        });
      } else {
        await publicar(c, ctx, {
          tipo: 'oraculo.quorum-perdido', sujeitoTipo: 'LEITURA', sujeitoId: leituraId,
          payload: {
            tipo, chave, fontes_ativas: independentes,
            fontes_exigidas: pol.min_fontes_independentes, decisoes_suspensas: [],
          },
        });
      }
      return leituraId;
    });

    log.info(ctx, 'leitura coletada', { tipo, chave, estado, fontes: coletadas.length, independentes });
    return { id, tipo, chave, estado, valorNumerico, valorJson, dispersao,
             fontesUsadas: coletadas.length, fontesIndependentes: independentes,
             hashLinhagem: linhagem, falhas };
  }

  private lerFonte(tipo: TipoLeitura, codigo: string, chave: string, url?: string) {
    switch (tipo) {
      case 'PRECO': return fontes.lerPreco(codigo);
      case 'PAGAMENTO': return fontes.lerPagamento(codigo, chave);
      case 'GEOESPACIAL': return fontes.lerGeo(codigo, chave);
      case 'REGISTRO': return fontes.lerRegistro(codigo, chave, url ?? process.env.URL_REGISTRADORA ?? '');
      default: throw new Error(`tipo ${tipo} sem adaptador`);
    }
  }

  /**
   * Leitura vigente com efeito contratual, ou 503.
   *
   * Dentro da janela de validade, a última leitura com quórum continua valendo
   * — é o desenho da política. Mas servir um preço de ontem durante uma queda é
   * a pró-ciclicidade que o MVP existe para medir, e por isso a resposta diz
   * quantos segundos tem o número e se as fontes estão caídas **agora**. Quem
   * consome decide com essa informação à vista; quem esconde, decide por ele.
   */
  async efetiva(tipo: TipoLeitura, chave: string) {
    const { rows } = await poolOps().query(
      `SELECT id, estado, valor_numerico, valor_json, fontes_usadas, fontes_independentes,
              dispersao_pct, expira_em, encode(hash_linhagem,'hex') AS hash_linhagem, coletada_em,
              EXTRACT(epoch FROM (now() - coletada_em))::int AS idade_segundos
         FROM ops.leitura_oraculo
        WHERE tipo_leitura = $1 AND chave = $2 AND estado IN ('EFETIVA','DEGRADADA') AND expira_em > now()
        ORDER BY coletada_em DESC LIMIT 1`, [tipo, chave]);
    if (!rows.length) throw semQuorum(tipo, `sem leitura vigente para ${chave}`);

    // Estado atual das fontes, não o do momento da coleta.
    const panorama = (await this.degradacao()).find((d) => d.tipo === tipo);
    const falhaCorrente = panorama ? panorama.sem_quorum : false;

    return {
      ...rows[0],
      hash_linhagem: '0x' + rows[0].hash_linhagem,
      fontes_ativas_agora: panorama?.fontes_ativas ?? null,
      fontes_independentes_agora: panorama?.fontes_independentes_ativas ?? null,
      fontes_exigidas: panorama?.fontes_exigidas ?? null,
      coleta_corrente_sem_quorum: falhaCorrente,
      aviso: falhaCorrente
        ? 'Valor dentro da janela de validade, mas a coleta corrente não atinge quórum. Trate como referência, não como preço de agora.'
        : null,
    };
  }

  async linhagem(leituraId: string) {
    const { rows: l } = await poolOps().query(
      `SELECT id, tipo_leitura, chave, estado, politica_snapshot,
              encode(hash_linhagem,'hex') AS hash_linhagem
         FROM ops.leitura_oraculo WHERE id = $1`, [leituraId]);
    if (!l.length) return null;
    const { rows: f } = await poolOps().query(
      `SELECT fo.codigo AS fonte, lf.valor_numerico, lf.valor_json, lf.recebido_em, lf.latencia_ms,
              encode(lf.bruto_hash,'hex') AS bruto_hash, lf.bruto_uri, lf.descartada, lf.motivo_descarte
         FROM ops.leitura_fonte lf JOIN ops.fonte_oraculo fo ON fo.id = lf.fonte_id
        WHERE lf.leitura_id = $1 ORDER BY lf.recebido_em`, [leituraId]);
    return {
      leitura_id: leituraId,
      politica_aplicada: l[0].politica_snapshot,
      hash_linhagem: '0x' + l[0].hash_linhagem,
      fontes: f.filter((x: { descartada: boolean }) => !x.descartada)
        .map((x: Record<string, unknown>) => ({ ...x, bruto_hash: '0x' + x.bruto_hash })),
      descartadas: f.filter((x: { descartada: boolean }) => x.descartada)
        .map((x: Record<string, unknown>) => ({ ...x, bruto_hash: '0x' + x.bruto_hash })),
    };
  }

  /** Panorama de degradação — contrato de fronteira com A6 e com a observabilidade. */
  async degradacao() {
    const { rows } = await poolOps().query<{ tipo_leitura: TipoLeitura; min_fontes_independentes: number }>(
      'SELECT tipo_leitura, min_fontes_independentes FROM ops.politica_quorum ORDER BY tipo_leitura');
    const derrubadas = new Set(fontes.fontesDerrubadas());
    const saida = [];
    for (const p of rows) {
      const fs = await this.fontesDe(p.tipo_leitura);
      const correlacao = new Map(fs.map((f) => [f.codigo, f.independente_de ?? []]));
      const ativas = fs.filter((f) => !derrubadas.has(f.codigo));
      // Contar fontes brutas aqui seria repetir, no painel de saúde, a
      // redundância aparente que a política de quórum recusa: o CEPEA e um
      // agregador que o republica são duas fontes ativas e uma só fonte
      // independente. O painel precisa dizer o número que decide.
      const independentesAtivas = this.contarIndependentes(ativas.map((f) => f.codigo), correlacao);
      saida.push({
        tipo: p.tipo_leitura,
        fontes_ativas: ativas.length,
        fontes_independentes_ativas: independentesAtivas,
        fontes_exigidas: p.min_fontes_independentes,
        degradado: ativas.length < fs.length,
        sem_quorum: independentesAtivas < p.min_fontes_independentes,
        cadastradas: fs.length,
      });
    }
    return saida;
  }
}
