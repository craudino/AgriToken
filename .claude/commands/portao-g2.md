---
description: Executa o portão G2 — segurança, dados e privacidade
---
Execute o portão **G2 — Segurança, dados e privacidade**.

Critério: contratos sem achado crítico; varredura de PII limpa; oráculos com
quórum funcionando sob falha injetada.

## Passo 1 — Evidência antes do parecer

Rode e anexe ao dossiê a saída de `npm run validar`, a cobertura de
`contracts/` e o resultado do teste de falha injetada de oráculo. Especialista
que precisa acreditar na sua palavra não está auditando.

## Passo 2 — Pareceres independentes e simultâneos

Invoque **em paralelo, em uma única mensagem, com contexto isolado**:
`e2-privacidade`, `e3-seguranca-contratos`, `e5-dados-geoespacial`.

## Passo 3 — Coleta e consolidação

Pareceres íntegros em `docs/panel/G2/`; dossiê em `docs/panel/G2/dossie.md`,
com a seção de conflitos destacada e não suavizada.

## Passo 4 — Ponto de sincronização de contratos

Antes de fechar o portão, verifique divergência silenciosa entre implementação
e especificação: `npm run validar` verde, ABIs conferindo, enums da API
coincidindo com os do banco, rotas implementadas correspondendo às declaradas.
Divergência detectada tarde é a principal fonte de retrabalho em construção
paralela.

## Passo 5 — Parada obrigatória

Aguarde decisão humana. Achado crítico aberto reprova o portão.
