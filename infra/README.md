# infra — diretório de A7

Esqueleto da Fase 0. O que existe aqui hoje são os portões de contrato; o
ambiente completo é W7.

| Caminho | O que é |
|---|---|
| `ci/validar-openapi.mjs` | Invariantes de fronteira das APIs (P1, P2, P3, P4, P6) |
| `ci/validar-eventos.mjs` | Esquemas de evento, exemplos e varredura de PII (P2, P5, P6) |
| `ci/validar-abis.mjs` | Compila interfaces, congela ABIs, testa a fronteira regulatória (P7) |
| `ci/validar-esquema.sh` | Sobe bases efêmeras, aplica o DDL e roda a conformidade (P1 a P6) |
| `ci/redocly.yaml` | Configuração de lint das OpenAPI |
| `db/aplicar.sh` | Aplica os esquemas congelados nas três bases |

`validar-esquema.sh` tem dois caminhos: com `OPS_URL`, `PII_URL` e `AUDIT_URL`
definidos, aplica nas bases fornecidas; sem elas, sobe um cluster efêmero
próprio. O primeiro serve ao CI, o segundo à máquina do desenvolvedor.

## O que falta construir em W7

Compose com os quatro validadores Besu e o simulador de registradora; as três
bases em instâncias separadas; OpenTelemetry ponta a ponta; gerador de dados
sintéticos com distribuição de porte da cafeicultura do Sul de Minas; e o
cenário de estresse de quebra de safra com queda simultânea de preço.
