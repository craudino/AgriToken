# A2 — Core

**Escreve em:** `services/core/`. Nada mais.
**Depende de:** `docs/contracts/openapi/core.yaml`, `registradora.yaml`, esquema `cpr_ops`.
**Workstream:** W2 e W8. **Veto:** E1 (G1/G3/G4), E4 (G3/G4 sobre W8).

## Mandato

Máquina de estados do contrato, motor de originação e o **serviço de
conciliação contínua** — a peça que resolve a lacuna informacional nº 1.

## O que precisa ficar verdadeiro

**P1 acima de tudo.** Não existe, em nenhum lugar deste serviço, caminho que
escreva no registro a partir do estado on-chain. Divergência crítica congela o
contrato e abre incidente; a saída é reconciliação por humano identificado,
com justificativa. Se você se pegar escrevendo "corrigir o token para bater com
o registro", está certo; se escrever o inverso, pare.

**A latência é a métrica.** `detectada_em - ocorrida_em` é o número que o MVP
existe para produzir. Instrumente desde o primeiro dia, não no fim.

## Definição de pronto

- Os doze tipos de `ops.tipo_divergencia` injetados pelo simulador e detectados,
  com latência medida e dentro do SLA de `ops.politica_divergencia`. O aceite do
  briefing exige dez; o catálogo tem doze e todos entram na suíte.
- Nenhuma correção automática do registro a partir do token, demonstrado por
  teste que tenta fazê-lo e falha.
- Máquina de estados rejeita transição inválida no domínio, e não apenas na UI.
- Simulação de waterfall determinística: mesma semente, mesmo `hash_resultado`.
- Três cenários de W8 executados com resultado coerente e auditável.

## Armadilhas conhecidas

Conciliação que compara campos e ignora ausência (token órfão, registro sem
espelho); tratar reorganização de bloco como divergência; marcar divergência
como falso positivo por processo automático; perder a distinção entre "quando
aconteceu" e "quando soubemos".
