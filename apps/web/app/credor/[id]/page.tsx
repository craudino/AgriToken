import { obterContrato, obterConciliacao, obterGarantias, obterTrilha, obterSituacaoProdutor } from '@/lib/api';

export const dynamic = 'force-dynamic';

const dinheiro = (v: string | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default async function Detalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const contrato = await obterContrato(id);
  if (!contrato) return <p>Contrato não encontrado.</p>;

  const [conc, garantias, trilha, produtor] = await Promise.all([
    obterConciliacao(id), obterGarantias(id), obterTrilha(id),
    obterSituacaoProdutor(contrato.produtor_ref),
  ]);

  const abertas = conc.divergencias.filter((d) => d.estado === 'ABERTA');

  return (
    <>
      <p style={{ marginTop: 18 }}><a href="/credor">← carteira</a></p>
      <h1 className="mono">{contrato.registro_id}</h1>

      {conc.situacao === 'CONGELADO' && (
        <div className="faixa-alerta">
          Congelado por divergência entre o registro e o espelho. O registro prevalece;
          a saída exige reconciliação por operador humano identificado.
        </div>
      )}

      <div className="grade">
        <div className="cartao">
          <div className="rotulo">Valor de face</div>
          <div className="numero">{dinheiro(contrato.valor_face)}</div>
        </div>
        <div className="cartao">
          <div className="rotulo">Marcado a mercado</div>
          <div className="numero">{dinheiro(contrato.valor_mtm)}</div>
          <div style={{ color: 'var(--suave)', fontSize: 13 }}>
            {contrato.valor_mtm ? 'deságio aplicado sobre o preço com quórum' : 'ainda não marcado'}
          </div>
        </div>
        <div className="cartao">
          <div className="rotulo">Produtor</div>
          <div style={{ marginTop: 4 }}>
            {produtor?.habilitado_a_originar
              ? <span className="selo ok">habilitado</span>
              : <span className="selo alerta">não habilitado</span>}
          </div>
          <div style={{ color: 'var(--suave)', fontSize: 13, marginTop: 6 }}>
            Referência opaca <code>{contrato.produtor_ref.slice(0, 12)}…</code> — a
            identidade não trafega para cá, por construção.
          </div>
        </div>
      </div>

      <h2>Divergências ({abertas.length} aberta{abertas.length === 1 ? '' : 's'})</h2>
      <div className="cartao" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr><th>Tipo</th><th>Severidade</th><th>Registro diz</th><th>Espelho diz</th>
                <th>Detecção</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {conc.divergencias.map((d) => (
              <tr key={d.id}>
                <td>{d.tipo.replaceAll('_', ' ').toLowerCase()}</td>
                <td>
                  <span className={d.severidade === 'CRITICA' || d.severidade === 'ALTA' ? 'selo alerta' : 'selo atencao'}>
                    {d.severidade.toLowerCase()}
                  </span>
                </td>
                <td className="mono">{JSON.stringify(d.valor_registro)?.slice(0, 40)}</td>
                <td className="mono">{JSON.stringify(d.valor_onchain)?.slice(0, 40)}</td>
                <td>{d.latencia_deteccao_ms != null ? `${(d.latencia_deteccao_ms / 1000).toFixed(1)} s após o fato` : '—'}</td>
                <td>{d.estado.toLowerCase()}</td>
              </tr>
            ))}
            {conc.divergencias.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--suave)' }}>
                Nenhuma divergência. Última conciliação em{' '}
                {conc.ultima_execucao_em ? new Date(conc.ultima_execucao_em).toLocaleString('pt-BR') : '—'} —
                ausência de divergência só significa algo porque a conciliação rodou.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Garantias</h2>
      <div className="cartao" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Nível</th><th>Tipo</th><th>Valor</th><th>Oponibilidade</th><th>Excussão</th></tr></thead>
          <tbody>
            {garantias.map((g, i) => (
              <tr key={i}>
                <td>{String(g.nivel_waterfall)}</td>
                <td>{String(g.tipo).replaceAll('_', ' ').toLowerCase()}</td>
                <td>{dinheiro(String(g.valor_declarado))}</td>
                <td>
                  {g.oponibilidade === 'AVERBADA'
                    ? <span className="selo ok">averbada</span>
                    : <span className="selo alerta">{String(g.oponibilidade).toLowerCase().replace('_', ' ')}</span>}
                </td>
                <td>{String(g.estado_excussao).toLowerCase().replaceAll('_', ' ')}</td>
              </tr>
            ))}
            {garantias.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--suave)' }}>Sem garantias vinculadas.</td></tr>}
          </tbody>
        </table>
      </div>
      <p style={{ color: 'var(--suave)', fontSize: 13 }}>
        Garantia real não averbada não é oponível a terceiros e não absorve perda na
        simulação — o que existe sem averbação é expectativa de recuperação.
      </p>

      <h2>O que se sabia, quando e com base em quê</h2>
      <div className="linha-tempo">
        {trilha.map((t, i) => (
          <div className="evento" key={i}>
            <div style={{ fontSize: 12.5, color: 'var(--suave)' }}>
              {new Date(t.quando).toLocaleString('pt-BR')} · {t.categoria.toLowerCase()} · {t.origem}
            </div>
            <div>{t.fato}</div>
          </div>
        ))}
        {trilha.length === 0 && <p style={{ color: 'var(--suave)' }}>Sem eventos.</p>}
      </div>
    </>
  );
}
