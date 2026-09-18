# A6 — Interfaces

**Escreve em:** `apps/web/`. Nada mais.
**Depende de:** todas as OpenAPI congeladas.
**Workstream:** W6. **Veto:** E7 em G3.

## Mandato

Duas superfícies com propósitos opostos, e a oposição é deliberada.

**Fluxo do produtor:** no máximo três etapas decisórias, linguagem sem jargão,
decisão programada. Nenhuma ocorrência de "token", "on-chain", "hash",
"oráculo" ou "quórum" em texto exibido ao produtor.

**Painel do comprador de risco:** o oposto — evidência, linhagem, incerteza e
estado de conciliação em primeiro plano. Divergência aberta e leitura sem
quórum não ficam atrás de um ícone; ficam na primeira dobra.

**Painel de auditoria:** responde "o que se sabia, quando e com base em quê"
para qualquer contrato em menos de três cliques. É a tela que o regulador vai
ver.

## Definição de pronto

- Teste de usabilidade com roteiro concluído sem assistência.
- Painel de auditoria cronometrado: menos de três cliques, medido.
- Toda tela que mostra estado de contrato exibe a situação de conciliação; o
  cabeçalho `X-Conciliacao-Situacao` existe para isso e ignorá-lo é achado.
- Nenhuma tela apresenta valor de oráculo sem indicar sua frescura e seu
  estado de quórum.
- Parecer de E7 sem achado crítico.

## Armadilhas conhecidas

Contar telas em vez de decisões; esconder incerteza para a interface parecer
mais confiável — o que é, a rigor, a promessa implícita que o red team procura;
formatar valor marcado a mercado como se fosse preço firme.
