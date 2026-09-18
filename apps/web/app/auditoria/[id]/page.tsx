import { obterContrato, obterTrilha, obterConciliacao } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function TrilhaContrato({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ate?: string }>;
}) {
  const { id } = await params;
  const { ate } = await searchParams;
  const [contrato, trilha, conc] = await Promise.all([
    obterContrato(id), obterTrilha(id, ate), obterConciliacao(id),
  ]);
  if (!contrato) return <p>Contrato não encontrado.</p>;

  return (
    <>
      <p style={{ marginTop: 18 }}><a href="/auditoria">← auditoria</a></p>
      <h1 className="mono">{contrato.registro_id}</h1>
      <p className="sub">
        {ate
          ? `Reconstituindo o que o sistema sabia até ${new Date(ate).toLocaleString('pt-BR')}.`
          : 'Linha do tempo completa. Use o corte temporal para reconstituir o conhecimento em um instante passado.'}
      </p>

      <div className="cartao">
        <div className="rotulo">Corte temporal</div>
        <form method="get" style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          <input type="datetime-local" name="ate" defaultValue={ate?.slice(0, 16)}
                 style={{ padding: 9, borderRadius: 8, border: '1px solid var(--borda)',
                          background: 'var(--fundo)', color: 'var(--texto)' }} />
          <button className="botao secundario" type="submit">Ver o que se sabia</button>
        </form>
      </div>

      <h2>Trilha ({trilha.length} eventos)</h2>
      <div className="linha-tempo">
        {trilha.map((t, i) => (
          <div className="evento" key={i}>
            <div style={{ fontSize: 12.5, color: 'var(--suave)' }}>
              {new Date(t.quando).toLocaleString('pt-BR')} · {t.categoria.toLowerCase()} · {t.origem}
            </div>
            <div>{t.fato}</div>
            {Boolean(t.evidencia) && (
              <details style={{ marginTop: 4 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--acento)' }}>
                  com base em quê
                </summary>
                <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--suave)' }}>
                  {JSON.stringify(t.evidencia, null, 2)}
                </pre>
              </details>
            )}
          </div>
        ))}
        {trilha.length === 0 && <p style={{ color: 'var(--suave)' }}>Nenhum evento no período.</p>}
      </div>

      <h2>Divergências</h2>
      <div className="cartao" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Tipo</th><th>Ocorreu</th><th>Detectado</th><th>Latência</th><th>Reconciliado por</th></tr></thead>
          <tbody>
            {conc.divergencias.map((d) => (
              <tr key={d.id}>
                <td>{d.tipo.replaceAll('_', ' ').toLowerCase()}</td>
                <td>{d.ocorrida_em ? new Date(d.ocorrida_em).toLocaleString('pt-BR') : '—'}</td>
                <td>{new Date(d.detectada_em).toLocaleString('pt-BR')}</td>
                <td>{d.latencia_deteccao_ms != null ? `${(d.latencia_deteccao_ms / 1000).toFixed(1)} s` : '—'}</td>
                <td>{d.estado === 'ABERTA' ? <span className="selo alerta">em aberto</span> : d.estado.toLowerCase()}</td>
              </tr>
            ))}
            {conc.divergencias.length === 0 && (
              <tr><td colSpan={5} style={{ color: 'var(--suave)' }}>Nenhuma divergência registrada.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
