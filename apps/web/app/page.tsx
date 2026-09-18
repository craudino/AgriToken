export const dynamic = 'force-dynamic';

export default function Inicio() {
  return (
    <>
      <h1>Três superfícies, três propósitos opostos</h1>
      <p className="sub">
        A oposição é deliberada. O produtor precisa de poucas decisões; o comprador de
        risco precisa de evidência e de incerteza à vista; o regulador precisa saber o
        que se sabia, quando e com base em quê.
      </p>
      <div className="grade">
        <a className="cartao" href="/produtor">
          <div className="rotulo">Fluxo do produtor</div>
          <h2 style={{ margin: '6px 0' }}>Antecipar a safra</h2>
          <p style={{ color: 'var(--suave)', margin: 0 }}>
            Três decisões, sem jargão. Nada de token, hash ou oráculo na tela de quem
            planta café.
          </p>
        </a>
        <a className="cartao" href="/credor">
          <div className="rotulo">Painel do comprador de risco</div>
          <h2 style={{ margin: '6px 0' }}>Avaliar antes de ofertar</h2>
          <p style={{ color: 'var(--suave)', margin: 0 }}>
            Divergência aberta e leitura sem quórum aparecem na primeira dobra, não
            atrás de um ícone.
          </p>
        </a>
        <a className="cartao" href="/auditoria">
          <div className="rotulo">Painel de auditoria</div>
          <h2 style={{ margin: '6px 0' }}>Reconstituir o conhecimento</h2>
          <p style={{ color: 'var(--suave)', margin: 0 }}>
            A pergunta do regulador respondida em menos de três cliques, com a trilha
            encadeada por hash.
          </p>
        </a>
      </div>
    </>
  );
}
