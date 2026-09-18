import { listarContratos, obterDegradacao, obterPlacar } from '@/lib/api';

export const dynamic = 'force-dynamic';

const dinheiro = (v: string | null) =>
  v === null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const seloConciliacao = (s: string) => {
  if (s === 'CONGELADO') return <span className="selo alerta">congelado</span>;
  if (s === 'DIVERGENTE') return <span className="selo alerta">divergente</span>;
  if (s === 'CONCILIADO') return <span className="selo ok">conciliado</span>;
  if (s === 'PENDENTE') return <span className="selo atencao">conciliação pendente</span>;
  return <span className="selo neutro">{s.toLowerCase()}</span>;
};

const seloEudr = (s: string | null) => {
  if (s === 'CONFORME') return <span className="selo ok">EUDR conforme</span>;
  if (s === 'NAO_CONFORME') return <span className="selo alerta">EUDR não conforme</span>;
  if (s === 'LIMITROFE') return <span className="selo atencao">EUDR limítrofe</span>;
  return <span className="selo neutro">sem selo</span>;
};

export default async function Credor() {
  const [contratos, degradacao, placar] = await Promise.all([
    listarContratos(), obterDegradacao(), obterPlacar(),
  ]);

  const congelados = contratos.filter((c) => c.situacao_conciliacao === 'CONGELADO');
  const semQuorum = degradacao.filter((d) => d.sem_quorum);

  return (
    <>
      <h1>Comprador de risco</h1>
      <p className="sub">
        O que está errado aparece primeiro. Contrato congelado não é detalhe de rodapé,
        e preço sem quórum não é preço.
      </p>

      {congelados.length > 0 && (
        <div className="faixa-alerta">
          {congelados.length} contrato(s) congelado(s) por divergência entre o registro e
          o espelho. Enquanto a divergência não for reconciliada por um humano, o registro
          prevalece e a circulação fica suspensa.
        </div>
      )}

      {semQuorum.length > 0 && (
        <div className="faixa-atencao">
          Sem quórum agora em: {semQuorum.map((d) => d.tipo).join(', ')}. Decisões
          contratuais que dependem dessas leituras estão suspensas — o sistema sinaliza
          em vez de estimar.
        </div>
      )}

      <div className="grade">
        <div className="cartao">
          <div className="rotulo">Contratos espelhados</div>
          <div className="numero">{contratos.filter((c) => c.token_id).length}</div>
        </div>
        <div className="cartao">
          <div className="rotulo">Divergências detectadas</div>
          <div className="numero">{placar.total_detectadas}/{placar.total_injetadas}</div>
          <div style={{ color: 'var(--suave)', fontSize: 13 }}>
            cobertura {placar.cobertura_pct ?? '—'}% do catálogo injetado
          </div>
        </div>
        <div className="cartao">
          <div className="rotulo">Fontes de dado por tipo</div>
          <div style={{ marginTop: 6, fontSize: 13.5 }}>
            {degradacao.map((d) => (
              <div key={d.tipo} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>{d.tipo.toLowerCase()}</span>
                <span className={d.sem_quorum ? 'selo alerta' : 'selo ok'}>
                  {d.fontes_independentes_ativas}/{d.fontes_exigidas} independentes
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <h2>Carteira</h2>
      <div className="cartao" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Registro</th><th>Conciliação</th><th>Estado</th><th>Selo</th>
              <th>Valor de face</th><th>Marcado a mercado</th><th>Vencimento</th><th></th>
            </tr>
          </thead>
          <tbody>
            {contratos.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.registro_id}</td>
                <td>{seloConciliacao(c.situacao_conciliacao)}</td>
                <td>{c.estado.toLowerCase().replace('_', ' ')}</td>
                <td>{seloEudr(c.selo_eudr)}</td>
                <td>{dinheiro(c.valor_face)}</td>
                <td>{dinheiro(c.valor_mtm)}</td>
                <td>{new Date(c.vencimento).toLocaleDateString('pt-BR')}</td>
                <td><a href={`/credor/${c.id}`}>evidência</a></td>
              </tr>
            ))}
            {contratos.length === 0 && (
              <tr><td colSpan={8} style={{ color: 'var(--suave)' }}>Nenhum contrato ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
