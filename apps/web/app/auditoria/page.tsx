import { listarContratos, obterPlacar, obterCadeiaAuditoria, obterBases, obterTratamentos } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Painel de auditoria. A pergunta do regulador — o que se sabia, quando e com
 * base em quê — precisa ser respondida em menos de três cliques: aqui,
 * contrato (1) → trilha (2). O terceiro clique é o detalhe da evidência.
 */
export default async function Auditoria() {
  const [contratos, placar, cadeia, bases, tratamentos] = await Promise.all([
    listarContratos(), obterPlacar(), obterCadeiaAuditoria(), obterBases(), obterTratamentos(),
  ]);

  return (
    <>
      <h1>Auditoria</h1>
      <p className="sub">
        Tudo aqui é verificável por conta própria: a trilha é encadeada por hash, a
        evidência de conformidade é reproduzível e o placar de detecção mede o que o
        sistema realmente pegou.
      </p>

      {cadeia.inconsistentes > 0 ? (
        <div className="faixa-alerta">
          Cadeia de auditoria inconsistente em {cadeia.inconsistentes} registro(s):
          alguém alterou ou suprimiu histórico. Este é o alerta mais importante e o mais
          esquecido.
        </div>
      ) : (
        <div className="cartao">
          <div className="rotulo">Trilha imutável</div>
          <div className="numero">{cadeia.registros} registros</div>
          <div style={{ color: 'var(--suave)', fontSize: 13 }}>
            cadeia de hash íntegra, verificada agora — supressão de registro seria detectável
          </div>
        </div>
      )}

      <h2>Placar de detecção de divergências</h2>
      <p style={{ color: 'var(--suave)', marginTop: 0, fontSize: 13.5 }}>
        Divergências injetadas deliberadamente no registro e na cadeia, e quanto tempo o
        sistema levou para vê-las. Tipos que dependem de premissas do simulador estão
        declarados no ADR-0006.
      </p>
      <div className="cartao" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Tipo</th><th>Injetadas</th><th>Detectadas</th><th>Latência mediana</th><th>SLA</th><th>Dentro do SLA</th></tr></thead>
          <tbody>
            {placar.por_tipo.map((t, i) => (
              <tr key={i}>
                <td>{String(t.tipo).replaceAll('_', ' ').toLowerCase()}</td>
                <td>{String(t.injetadas)}</td>
                <td>
                  {String(t.detectadas) === String(t.injetadas)
                    ? <span className="selo ok">{String(t.detectadas)}</span>
                    : <span className="selo alerta">{String(t.detectadas)}</span>}
                </td>
                <td>{t.latencia_p50_ms != null ? `${(Number(t.latencia_p50_ms) / 1000).toFixed(1)} s` : '—'}</td>
                <td>{String(t.sla)}</td>
                <td>{String(t.dentro_do_sla)}</td>
              </tr>
            ))}
            {placar.por_tipo.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--suave)' }}>Nenhuma injeção registrada ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Contratos</h2>
      <div className="cartao" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Registro</th><th>Estado</th><th>Conciliação</th><th>Trilha</th></tr></thead>
          <tbody>
            {contratos.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.registro_id}</td>
                <td>{c.estado.toLowerCase().replaceAll('_', ' ')}</td>
                <td>{c.situacao_conciliacao.toLowerCase()}</td>
                <td><a href={`/auditoria/${c.id}`}>abrir trilha</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Bases de referência ambiental</h2>
      <div className="cartao" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Base</th><th>Versão</th><th>Data de corte</th><th>Resolução</th><th>Hash do conjunto</th></tr></thead>
          <tbody>
            {bases.map((b, i) => (
              <tr key={i}>
                <td>{String(b.codigo)}</td>
                <td>{String(b.versao)}</td>
                <td>{new Date(String(b.data_corte)).toLocaleDateString('pt-BR')}</td>
                <td>{String(b.resolucao_m ?? '—')} m</td>
                <td className="mono">{String(b.hash_dataset).slice(0, 18)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Operações de tratamento de dado pessoal</h2>
      <p style={{ color: 'var(--suave)', marginTop: 0, fontSize: 13.5 }}>
        Todo acesso a texto claro passa por aqui. Se o registro de acesso fosse opcional,
        ele não existiria quando o regulador perguntasse.
      </p>
      <div className="cartao" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Operação</th><th>Finalidade</th><th>Base legal</th><th>Campos</th><th>Quando</th></tr></thead>
          <tbody>
            {tratamentos.slice(0, 12).map((t, i) => (
              <tr key={i}>
                <td>{String(t.operacao).toLowerCase()}</td>
                <td>{String(t.finalidade)}</td>
                <td>{String(t.base_legal).toLowerCase().replaceAll('_', ' ')}</td>
                <td className="mono">{(t.campos as string[])?.join(', ')}</td>
                <td>{new Date(String(t.ocorrido_em)).toLocaleString('pt-BR')}</td>
              </tr>
            ))}
            {tratamentos.length === 0 && (
              <tr><td colSpan={5} style={{ color: 'var(--suave)' }}>Nenhuma operação registrada.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
