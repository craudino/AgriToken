# ADR-0003 — Exigir quórum de fontes independentes por tipo de leitura, com degradação explícita

- **Estado:** Proposto — pendente de G1
- **Data:** 2026-09-18
- **Decisores:** orquestrador; veto de E5 e E3 em G2; veto de E8 em G4
- **Portão:** G1

## Contexto

O credor precisa confiar em atributos que ele não consegue medir: preço de
mercado, conformidade ambiental, ocorrência de pagamento, situação fiscal. Essa
é a função econômica central da plataforma — reduzir custo de mensuração. Se a
medição depender de uma única fonte externa, a plataforma não reduziu o custo
de mensuração: apenas o transferiu para a fonte, sem que o credor saiba.

A pergunta que governa este ADR é a de E5: *de onde veio este número e o que
acontece se a fonte cair?* Um sistema que responde à segunda parte com "estima
pelo último valor conhecido" produz exatamente o tipo de decisão silenciosa
que a arquitetura existe para impedir.

## Alternativas consideradas

**Fonte única por tipo, com cache.** Mais simples e mais barata. Rejeitada por
P4 e pela razão econômica: fonte única é ponto único de captura e de falha, e o
credor não tem como distinguir um preço correto de um preço errado publicado
com confiança.

**Mediana de N fontes sem verificar independência.** Rejeitada por motivo sutil
e importante: dois agregadores que republicam o mesmo boletim parecem duas
fontes e são uma. A redundância aparente é pior que a ausência de redundância,
porque induz confiança injustificada. Daí o campo `independente_de` em
`ops.fonte_oraculo` e a exigência separada de `min_fontes_independentes`.

**Oráculo on-chain com staking e disputa econômica.** Rejeitada por
superengenharia para o MVP e por arrastar a plataforma para perto do perímetro
de ativo virtual (P7).

## Decisão

Quórum configurável **por tipo de leitura**, com duas exigências separadas
(número de fontes e número de fontes independentes) e uma classificação de
criticidade que não admite exceção:

| Tipo | Criticidade | Fontes | Independentes | Agregação | Janela | Degradação |
|---|---|---|---|---|---|---|
| PRECO | CONTRATUAL | 3 | 2 | mediana | 36 h | permitida, sinalizada |
| GEOESPACIAL | CONTRATUAL | 2 | 2 | interseção | 90 d | não |
| PAGAMENTO | CONTRATUAL | 2 | 2 | unanimidade | 7 d | não |
| REGISTRO | CONTRATUAL | 2 | 2 | unanimidade | 24 h | não |
| FISCAL | CONTRATUAL | 2 | 2 | unanimidade | 30 d | não |
| CLIMATICO | INFORMATIVA | 1 | 1 | média ponderada | 24 h | permitida |

Três decisões dentro da decisão, cada uma com razão própria:

**Agregação por interseção no geoespacial.** Se uma base aponta sobreposição
com desmatamento e outra não, o resultado é `LIMITROFE` ou `NAO_CONFORME`,
nunca `CONFORME`. O erro de classificar como conforme um talhão que não é
contamina o colateral inteiro e a DDS emitida; o erro inverso custa uma
reavaliação.

**Unanimidade em pagamento e registro.** São fatos binários, não medições. Duas
fontes que discordam sobre "houve pagamento" significam que não se sabe, e não
que a média é meio pagamento.

**Climático é INFORMATIVA, e a base impede que vire contratual.** O gatilho de
`ops.uso_leitura` recusa leitura informativa como insumo de decisão contratual.
Sem essa trava, é questão de tempo até alguém acionar inadimplência com base em
um único boletim meteorológico.

Quando o quórum não é atingido, a resposta é `503` com `principio_violado: P4`
e estado `SEM_QUORUM`. **Não há caminho de código que produza decisão
contratual com fonte única.** A restrição existe em três camadas: CHECK na
tabela `ops.politica_quorum`, gatilho em `ops.uso_leitura` e contrato de API.

Toda leitura preserva o payload cru arquivado e o hash de linhagem, de modo que
"de onde veio este número" tenha resposta verificável, não narrada (P5, P6).

## Consequências

Positivas: nenhuma decisão contratual materialmente relevante depende de um
fornecedor; a queda de uma fonte é visível ao credor no painel, em vez de
invisível; e a disputa suspende efeito sem apagar histórico.

Negativas: o sistema fica **mais frágil em disponibilidade e mais robusto em
correção** — uma troca deliberada. Com três fontes de preço e exigência de
duas independentes, a indisponibilidade de duas paralisa a marcação a mercado.
Isso é intencional: parar é melhor que precificar errado um colateral. Mas
implica custo operacional real (contratos com múltiplos provedores) e exige
que E8 desenhe degradação graciosa de verdade, com alerta e caminho manual.

Custo adicional: cada leitura contratual multiplica chamadas externas,
armazenamento de payload cru e latência. É o preço da resposta à pergunta do
credor.

## Critérios de revisão

1. Indisponibilidade de fonte crítica acima de 1% do tempo em um mês, ou
   paralisação de marcação a mercado por mais de 4 horas seguidas.
2. Dispersão sistemática entre fontes de preço acima da tolerância, indicando
   que a chave de leitura está mal definida (praça, tipo, bica corrida).
3. Surgimento de fonte oficial de referência inequívoca para um tipo, caso em
   que a exigência de redundância pode ser reavaliada — mas não eliminada.
4. Evidência de correlação oculta entre fontes declaradas independentes.

## Veto e ressalvas

A registrar no dossiê de G1.

## Fontes

- Parametrização inicial (janelas, dispersão, número de fontes) é hipótese de
  engenharia a ser calibrada com dados do piloto. Não há fonte externa que a
  sustente hoje. [#REF]
