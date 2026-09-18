---
description: Executa o portão G3 — prontidão de demonstração, com premortem obrigatório
---
Execute o portão **G3 — Prontidão de demonstração**.

Critério: a demonstração de ponta a ponta — da originação à liquidação,
passando por uma divergência injetada e detectada — roda **sem intervenção
manual**, e o painel de auditoria sustenta escrutínio.

## Passo 1 — Rode a demonstração e grave o resultado

Execute o roteiro completo. Anexe o placar de conciliação
(`ops.vw_placar_conciliacao`): quantos tipos injetados, quantos detectados,
latência por tipo, quantos dentro do SLA. Se algum tipo não foi detectado, o
portão já está reprovado; leve o parecer assim mesmo, porque o motivo importa.

## Passo 2 — Premortem obrigatório

Antes dos pareceres, invoque **em paralelo e com contexto isolado** todos os
especialistas com veto neste portão — `e1`, `e2`, `e3`, `e4`, `e5`, `e7` — com
a consigna:

> Estamos doze meses à frente. O MVP falhou publicamente. Escreva a autópsia:
> o que deu errado, quando começou a dar errado, e qual sinal existia hoje que
> foi ignorado.

Grave em `docs/panel/G3/premortem/`. Este exercício é o antídoto mais eficaz
contra o excesso de otimismo do construtor — e o construtor, aqui, é você.

## Passo 3 — Pareceres independentes e simultâneos

Invoque os mesmos seis especialistas, em paralelo e isolados, para o parecer
de portão propriamente dito.

## Passo 4 — Consolidação

`docs/panel/G3/dossie.md`, com conflitos destacados, os sinais apontados pelo
premortem cruzados com os achados, e a recomendação do orquestrador separada.

## Passo 5 — Parada obrigatória

Aguarde decisão humana.
