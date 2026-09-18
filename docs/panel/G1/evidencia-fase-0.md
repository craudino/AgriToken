# Anexo de evidência da Fase 0 — portão G1

> Produzido pelo **orquestrador**, não pelo painel. Serve para que a decisão
> humana tenha o inventário do que existe; os pareceres, esses sim
> independentes, estão nos arquivos vizinhos. Data: 2026-09-18.

## Artefatos produzidos

| Área | Arquivos | Linhas |
|---|---:|---:|
| `docs/contracts/db` | 19 | 1495 |
| `docs/contracts/openapi` | 7 | 1555 |
| `docs/contracts/abi` | 7 | 2104 |
| `docs/contracts/events` | 5 | 574 |
| `contracts/interfaces` | 6 | 359 |
| `docs/adr` | 6 | 521 |
| `.claude/agents` | 16 | 517 |
| `.claude/commands` | 6 | 214 |
| `infra/ci` | 5 | 520 |

Seis commits, nenhuma linha de implementação — por determinação do briefing
(Seção 8): se G1 reprovar, nenhuma linha é escrita.

## Saída da verificação automatizada

`npm run validar` encerra com código 0 e 34 verificações aprovadas. Elas se
distribuem assim:

| Verificador | O que prova | Princípios |
|---|---|---|
| `validar-openapi.mjs` | 6 invariantes de fronteira, incluindo a comparação entre os enums da API e os do banco | P1, P2, P3, P4, P5, P6 |
| `validar-eventos.mjs` | Catálogo e payloads cobrem-se, 18 exemplos válidos, varredura de PII em campos e valores, canonicalização idêntica à do banco | P2, P5, P6 |
| `validar-abis.mjs` | ABIs conferem com as interfaces; nenhuma função de custódia, novação ou rendimento; nenhum texto livre em função mutante; cofre sem `payable` | P1, P2, P6, P7 |
| `validar-esquema.sh` | 18 testes de conformidade em bases efêmeras reais | P1, P2, P3, P4, P5, P6 |

Saída completa preservada no log do CI. Os testes do esquema não verificam que
a restrição existe: eles **tentam violá-la e exigem a recusa**. Por exemplo, a
tentativa de gravar CPF em campo textual de `cpr_ops` é rejeitada pelo domínio
`texto_sem_pii`; a de transicionar contrato congelado é rejeitada pelo gatilho
de P1; a de configurar leitura contratual de fonte única é rejeitada pelo CHECK
de P4.

## Mapeamento das oito capacidades (Briefing 1.1)

O que a Fase 0 entrega é **especificação**, não funcionalidade. A coluna
"estado" abaixo diz apenas se o contrato que sustentará a capacidade existe e
está congelado.

| # | Capacidade | Artefatos da Fase 0 | Estado |
|---|---|---|---|
| F1 | Onboarding e KYC/KYB com CAR/SICAR | `compliance.yaml`, `db/pii/*`, `ops.produtor` | Contrato congelado |
| F2 | Originação e espelhamento (ERC-3525) | `IEspelhoCPR`, `IAncoraRegistro`, `core.yaml`, `ops.contrato` | Contrato congelado |
| F3 | Conciliação contínua registro↔token | `ops.divergencia` (12 tipos), `ops.politica_divergencia`, `registradora.yaml`, `sim.injecao` | Contrato congelado |
| F4 | Motor EUDR | `eudr.yaml`, `ops.evidencia_eudr`, `ops.dds`, `ops.base_referencia_geo` | Contrato congelado |
| F5 | Marcação a mercado | `ops.marcacao_mercado`, `ops.politica_quorum` (PRECO), `oracle.yaml` | Contrato congelado |
| F6 | Garantias e waterfall | `ICofreGarantias`, `ops.waterfall_*`, `ops.simulacao_*` | Contrato congelado |
| F7 | Painel do comprador de risco | `core.yaml` (`/contratos/{id}/trilha`), `ops.vw_conhecimento_contrato`, `apps/web/AGENT.md` | Contrato congelado |
| F8 | Liquidação e baixa | `core.yaml` (`/liquidacao`), `IEspelhoCPR.baixar`, política de quórum PAGAMENTO | Contrato congelado |

## O que a Fase 0 **não** responde

Registre-se com franqueza, porque o portão existe para isso:

1. **Nenhuma lacuna informacional foi fechada.** Contrato congelado não é
   evidência decisória. A latência de detecção de divergência — o número que
   resolve a lacuna nº 1 — só existirá quando W2 rodar contra o simulador.
2. **A viabilidade da conciliação está assumida, não demonstrada.** O catálogo
   de doze tipos de divergência é hipótese de engenharia: nada garante que uma
   registradora real exponha o suficiente para detectar todos.
3. **O custo real de verificação por produtor (F1) é desconhecido.** A
   especificação pressupõe integração com CAR/SICAR e listas restritivas cujo
   custo e disponibilidade não foram medidos.
4. **A parametrização de quórum e de waterfall é palpite calibrável.** Os
   números em `ops.politica_quorum` e `ops.waterfall_nivel` não vêm de dados.
