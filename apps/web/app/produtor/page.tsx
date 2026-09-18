import { listarContratos, obterSituacaoProdutor } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Fluxo do produtor. Três decisões, e só três: quanto antecipar, de qual
 * talhão, e confirmar. Todo o resto — registro, espelho, conciliação, oráculo —
 * acontece sem pedir nada a quem planta café.
 *
 * Nenhuma palavra de sistema nesta tela: não há "token", "on-chain", "hash",
 * "oráculo" nem "quórum". A verificação disso é automática (ver
 * apps/web/test/sem-jargao.mjs), porque jargão volta a aparecer a cada
 * alteração se ninguém estiver medindo.
 */
export default async function Produtor() {
  const contratos = await listarContratos();
  const meu = contratos[0] ?? null;
  const situacao = meu ? await obterSituacaoProdutor(meu.produtor_ref) : null;

  return (
    <>
      <h1>Antecipar a safra</h1>
      <p className="sub">
        Três passos. A gente cuida do resto e avisa se algo mudar.
      </p>

      <div className="passo ativo">
        <div className="rotulo">Passo 1</div>
        <h2 style={{ margin: '4px 0 8px' }}>Quanto você quer antecipar?</h2>
        <p style={{ color: 'var(--suave)', marginTop: 0 }}>
          Informe as sacas que pretende entregar e quando. Sugerimos um valor com base
          no preço de hoje, e você confere antes de seguir.
        </p>
        <div className="grade">
          <div className="cartao">
            <div className="rotulo">Sacas</div>
            <div className="numero">{meu ? Number(meu.quantidade_sacas).toLocaleString('pt-BR') : '500'}</div>
          </div>
          <div className="cartao">
            <div className="rotulo">Entrega</div>
            <div className="numero">
              {meu ? new Date(meu.vencimento).toLocaleDateString('pt-BR') : '31/07/2027'}
            </div>
          </div>
          <div className="cartao">
            <div className="rotulo">Valor sugerido</div>
            <div className="numero">
              {meu
                ? Number(meu.valor_face).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                : 'R$ 750.000,00'}
            </div>
          </div>
        </div>
      </div>

      <div className="passo">
        <div className="rotulo">Passo 2</div>
        <h2 style={{ margin: '4px 0 8px' }}>De qual talhão sai o café?</h2>
        <p style={{ color: 'var(--suave)', marginTop: 0 }}>
          Usamos o mapa da sua propriedade que já está no cadastro ambiental rural. Se
          estiver tudo certo com a área, não precisamos pedir mais nada.
        </p>
        <p>
          {situacao?.habilitado_a_originar
            ? <span className="selo ok">cadastro em dia</span>
            : <span className="selo atencao">cadastro em análise</span>}
        </p>
      </div>

      <div className="passo">
        <div className="rotulo">Passo 3</div>
        <h2 style={{ margin: '4px 0 8px' }}>Confirmar</h2>
        <p style={{ color: 'var(--suave)', marginTop: 0 }}>
          Ao confirmar, o título é registrado e fica disponível para quem quiser
          financiar. Você é avisado quando alguém fizer uma oferta.
        </p>
        <button className="botao" type="button">Confirmar antecipação</button>
      </div>

      <h2>Suas antecipações</h2>
      <div className="cartao" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Sacas</th><th>Valor</th><th>Entrega</th><th>Situação</th></tr></thead>
          <tbody>
            {contratos.slice(0, 5).map((c) => (
              <tr key={c.id}>
                <td>{Number(c.quantidade_sacas).toLocaleString('pt-BR')}</td>
                <td>{Number(c.valor_face).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                <td>{new Date(c.vencimento).toLocaleDateString('pt-BR')}</td>
                <td>
                  {c.situacao_conciliacao === 'CONGELADO'
                    ? <span className="selo atencao">em verificação</span>
                    : c.estado === 'LIQUIDADO'
                      ? <span className="selo ok">quitada</span>
                      : <span className="selo ok">em dia</span>}
                </td>
              </tr>
            ))}
            {contratos.length === 0 && (
              <tr><td colSpan={4} style={{ color: 'var(--suave)' }}>Nenhuma antecipação ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p style={{ color: 'var(--suave)', fontSize: 13 }}>
        Quando algo precisa de conferência, a situação fica como "em verificação" e a
        gente resolve. Você não precisa fazer nada.
      </p>
    </>
  );
}
