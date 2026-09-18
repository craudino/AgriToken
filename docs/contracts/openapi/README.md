# Contratos de API — artefato congelado da Fase 0

Cinco especificações OpenAPI 3.1. `comum.yaml` não é um serviço: é o conjunto
de tipos, erros e cabeçalhos que todos compartilham.

| Arquivo | Serviço | Agente dono |
|---|---|---|
| `comum.yaml` | componentes compartilhados | orquestrador |
| `core.yaml` | `services/core` | A2 |
| `oracle.yaml` | `services/oracle` | A3 |
| `eudr.yaml` | `services/eudr` | A4 |
| `compliance.yaml` | `services/compliance` | A5 |
| `registradora.yaml` | fronteira externa + simulador | A2 implementa o cliente; A7 hospeda o simulador |

## Contratos de fronteira entre A2 e A6 (explícitos)

Cada linha é uma dependência que **não pode ser alterada unilateralmente**.
Quem consome não conhece o banco de quem serve; conhece apenas estas rotas.

| Consumidor | Produtor | Rota | O que atravessa a fronteira |
|---|---|---|---|
| A2 core | A3 oracle | `GET /leituras/efetiva` | Preço com quórum para marcação a mercado (F5) |
| A2 core | A3 oracle | `GET /leituras/efetiva?tipo=PAGAMENTO` | Confirmação de pagamento para liquidação (F8) |
| A2 core | A4 eudr | `GET /evidencias/{id}` | Selo como atributo do colateral (F4) |
| A2 core | A5 compliance | `GET /produtores/{ref}/situacao` | Habilitação para originar (F1) |
| A2 core | registradora | `GET /titulos/...` | Estado registrado — fonte de verdade (F3) |
| A4 eudr | A3 oracle | `GET /leituras/efetiva?tipo=GEOESPACIAL` | Quórum de bases de desmatamento |
| A4 eudr | A5 compliance | registro de tratamento ao servir geometria | Rastro de acesso a dado reidentificante |
| A6 web | A2 core | `GET /contratos`, `/contratos/{id}/trilha`, `/contratos/{id}/conciliacao` | Painel do comprador e de auditoria (F7) |
| A6 web | A3 oracle | `GET /leituras/{id}/linhagem`, `/saude/degradacao` | "De onde veio este número" |
| A6 web | A5 compliance | `POST /onboarding`, `GET /produtores/{ref}/situacao` | Fluxo do produtor (F1) |

## Invariantes de API que valem para todos

1. Toda rota que cria efeito irreversível exige `Idempotency-Key` (P3).
2. Toda resposta que carrega estado de contrato traz `X-Conciliacao-Situacao`,
   para que nenhum consumidor possa alegar desconhecimento de divergência (P1).
3. Erro decorrente de princípio traz `principio_violado` no corpo (RFC 9457).
4. `503` com `principio_violado: P4` é resposta correta e esperada quando o
   quórum cai. Degradar e sinalizar é o comportamento; adivinhar não é.
5. Nenhum esquema, exceto `POST /onboarding` em `compliance.yaml`, admite
   campo com dado pessoal identificável (P2).
6. Não existe rota que escreva no registro a partir do estado on-chain. A
   ausência é parte do contrato e é verificada em CI (P1, P7).

Validação: `infra/ci/validar-openapi.mjs` resolve as referências externas,
verifica a conformidade 3.1 e testa os invariantes 1, 2 e 6 acima.
