# ADR-0006 — Declarar as premissas embutidas no simulador de registradora

- **Estado:** Proposto — decorrente da decisão humana em G1
- **Data:** 2026-09-18
- **Decisores:** orquestrador; veto de E6 em G1 e G4; E8 em G4
- **Portão:** G1 (retroativo — ausência apontada por E6 A2)

## Contexto

A lacuna informacional nº 1 — a mais valiosa do MVP — é comprada contra um
simulador cuja interface a própria equipe especificou. E6 apontou em G1 que
`registradora.yaml` embute premissas que nunca foram declaradas, e que **a
premissa mais carregada do projeto não tinha ADR**.

Isso importa porque o simulador não é neutro: ele define o que é possível
detectar. Um simulador generoso produz um placar bonito e uma conclusão falsa.

## Premissas embutidas, agora explícitas

| # | Premissa | Onde está | Se cair |
|---|---|---|---|
| PR1 | A registradora expõe feed incremental de alterações | `GET /titulos?desde=` | Só resta varredura completa periódica; o SLA de 15 minutos de `ops.politica_divergencia` fica inviável e o congelamento automático não dispara a tempo |
| PR2 | A projeção do título traz ônus e gravames | `Titulo.onus[]` | `ONUS_OU_GRAVAME_NAO_REFLETIDO` fica indetectável por construção |
| PR3 | A projeção traz cessões | `Titulo.cessoes[]` | `CESSAO_NAO_REFLETIDA` e `TRANSFERENCIA_SEM_CESSAO` ficam indetectáveis |
| PR4 | Há hash ou versão do conteúdo do título | `Titulo.conteudo_hash` | `HASH_DOCUMENTAL_DIVERGENTE` fica indetectável |
| PR5 | A tarifação de consulta comporta a frequência do SLA | — | O SLA vira função de custo, não de engenharia |
| PR6 | A consulta é autenticada por mTLS e a resposta é atribuível | `security: mtls` | A leitura do registro deixa de ser evidência oponível |

Quatro dos quatorze tipos de divergência dependem de PR2, PR3 e PR4. Sem elas,
o placar de detecção continuaria verde — medindo apenas o que o simulador
resolveu expor.

## Decisão

1. As seis premissas ficam **declaradas neste ADR** e referenciadas no
   `registradora.yaml`.
2. O placar de conciliação passa a exibir, ao lado do resultado, **quais tipos
   dependem de qual premissa**. Um tipo detectado sob premissa não confirmada
   com registradora real é reportado como *detectado sob premissa PRn*, nunca
   como simplesmente detectado.
3. O dossiê de G4 responde sobre F3 declarando o grau de confirmação de cada
   premissa. Confirmar PR1 a PR4 com uma registradora real é a primeira
   pergunta do piloto assistido, antes de qualquer escala.

## Consequências

Positivas: o placar deixa de ser autoelogio. A distinção entre "o sistema
detecta" e "o sistema detecta dado um simulador que a equipe escreveu" passa a
estar no próprio relatório.

Negativas: o resultado de F3 fica visivelmente mais fraco do que pareceria sem
este ADR. É o custo de dizer a verdade sobre o que foi medido, e é preferível a
descobrir no piloto que quatro dos quatorze tipos nunca foram detectáveis.

## Critérios de revisão

1. Primeira integração com registradora real: cada premissa vira confirmada ou
   refutada, e as refutadas reabrem o desenho da conciliação.
2. Mudança de interface ou de tarifação por parte da registradora.
3. Qualquer novo tipo de divergência que dependa de campo não previsto aqui.

## Veto e ressalvas

A registrar no próximo portão em que E6 e E8 tenham veto.

## Fontes

Nenhuma fonte externa consultada sobre interface, granularidade ou preço de
registradoras reais. Todas as premissas são hipóteses de engenharia. [#REF]
