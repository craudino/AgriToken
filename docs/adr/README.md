# Registros de decisão arquitetural (ADR)

Toda decisão estrutural vive aqui. A regra do briefing (Seção 3.2, passo 5) é
literal: **não há decisão não registrada**. Um ADR ausente não significa que a
decisão não foi tomada — significa que ela foi tomada sem deixar rastro, que é
pior.

| ADR | Assunto | Estado |
|---|---|---|
| [0001](0001-rede-distribuida.md) | Escolha da rede distribuída | Proposto — pendente de G1 |
| [0002](0002-privacidade-onchain-offchain.md) | Estratégia de privacidade on-chain/off-chain | Proposto — pendente de G1 |
| [0003](0003-politica-quorum-oraculos.md) | Política de quórum de oráculos | Proposto — pendente de G1 |
| [0004](0004-upgradeability-contratos.md) | Upgradeability dos contratos | Proposto — pendente de G1 |
| [0005](0005-perimetro-regulatorio.md) | Perímetro regulatório | Proposto — lacuna apontada por E1 em G1 |
| [0006](0006-premissas-da-registradora.md) | Premissas do simulador de registradora | Proposto — lacuna apontada por E6 em G1 |
| [0007](0007-tensao-p1-p7.md) | Tensão entre congelamento e não-controle | Proposto — tensão apontada pelo red team em G1 |
| [0008](0008-desvios-de-ambiente-do-prototipo.md) | Desvios de stack do protótipo | Aceito |

## Estados

`Proposto` → `Aceito` → (`Substituído por NNNN` | `Revogado`). Um ADR aceito
nunca é editado no corpo da decisão: para mudar de ideia, escreva outro e
marque o anterior como substituído. O histórico de como se pensou errado é
parte do que torna a arquitetura auditável.

## Sobre as fontes

Afirmação factual sobre norma, regulação ou fato de mercado traz a fonte
consultada. Afirmação pertinente que **não** foi verificada em fonte externa
confiável é marcada com `[#REF]` — o leitor precisa saber a diferença entre o
que se conferiu e o que se supôs.
