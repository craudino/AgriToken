# Estado do protótipo — o que está provado e o que não está

**Data:** 2026-09-18 · **Branch:** `claude/sleepy-euler-vzyddj`

Este documento existe para impedir a confusão mais cara deste tipo de projeto:
tomar "o software roda" por "a pergunta foi respondida". O critério do briefing
é o segundo, e boa parte dele continua em aberto.

## O que sobe e roda

```bash
npm install
node infra/orquestrar.mjs subir     # banco, nó EVM, contratos e cinco serviços
npm run demo                        # demonstração ponta a ponta, 20 passos
npm run aceite:conciliacao          # os 14 tipos de divergência
npm run validar                     # 48 verificações de contrato e princípio
npx hardhat test                    # 61 testes de contrato inteligente
```

| Componente | Estado | Porta |
|---|---|---|
| `packages/nucleo` | Tipos gerados dos contratos congelados, eventos, auditoria, custo | — |
| `contracts/` (A1) | 5 contratos, 61 testes, 100% de linhas, 90% de ramos | 8545 |
| `services/compliance` (A5) | Onboarding, KYC, cofre cifrado, VC, crypto-shredding | 3001 |
| `services/oracle` (A3) | Quórum por independência, disputa, linhagem, degradação | 3002 |
| `services/core` (A2) | Domínio, conciliação, MTM, waterfall, liquidação | 3003 |
| `services/eudr` (A4) | Polígonos, cruzamento, evidência, DDS, reavaliação | 3004 |
| `infra/simulador-registradora` (A7) | Interface esperada + injeção de divergências | 3005 |
| `apps/web` (A6) | Produtor, comprador de risco, auditoria | 3000 |

## O que está efetivamente provado

| Afirmação | Como se verifica | Resultado |
|---|---|---|
| As 14 divergências do catálogo são detectadas | `npm run aceite:conciliacao` | 14/14; 85–130 ms no lado do registro, ~4,3 s no lado do token |
| Duplicidade de âncora é impossível | Teste de invariante I1 e o próprio aceite | Reverte na segunda emissão — prevenção, não detecção |
| Congelamento não se destranca sozinho | `conformidade_ops.sql` executa o ataque | Recusado sem divergência reconciliada e sem ator humano |
| Decisão contratual não sai de fonte única | Testes de esquema e teste de falha injetada | Recusado no banco e no serviço, inclusive no ramo degradado |
| Nenhum dado pessoal na cadeia | `npm run validar:pii-cadeia` com autoteste do detector | Limpo em calldata, logs e tópicos |
| Eliminação do titular é irreversível | Demonstração, passo 18 | Decifragem após destruição falha como esperado |
| Evidência EUDR é reproduzível | `POST /evidencias/{id}/reproducao` | Reproduzível nos três perfis (conforme, não conforme, limítrofe) |
| Trilha de auditoria é íntegra | `audit.verifica_cadeia()` | 38 registros encadeados, 0 inconsistências |
| Simulação de waterfall é determinística | Demonstração, passo 14 | Mesmo hash na repetição |
| Fluxo do produtor não tem jargão | `npm run validar:web` | 3 etapas, 1 decisão, nenhuma palavra de sistema |

## As oito lacunas informacionais (Briefing 1.1)

| # | Lacuna | Estado | Por quê |
|---|---|---|---|
| F1 | Custo de verificação por produtor | **Parcial** | Instrumentado e medido, mas sobre tarifas do simulador, não preços contratados. [#REF] |
| F2 | Viabilidade técnica e jurídica do espelho | **Parcial** | Tecnicamente demonstrado; juridicamente, E1 reprovou G1 e não houve nova rodada de parecer |
| F3 | Conciliação registro↔token | **Resolvida no simulador** | 14/14 com latência medida — porém contra um simulador que a própria equipe especificou (ADR-0006) |
| F4 | Custo e viabilidade do selo EUDR | **Parcial** | Motor funciona e o custo é medido; as bases são sintéticas e as tarifas, arbitradas |
| F5 | Pró-ciclicidade de receita e colateral | **Resolvida** | Cenário de estresse mostra preço caindo 24% e LTV indo de 127% para 192% |
| F6 | Executoriedade e calibração do fundo | **Parcial** | Waterfall simula e distingue seguro de garantia real não oponível; a calibração é palpite |
| F7 | Disposição a pagar do lado credor | **Não resolvida** | Há instrumento (`ops.reacao_credor`) e painel; não há credor real reagindo |
| F8 | Fechamento do ciclo contratual | **Resolvida no simulador** | Liquidação com pagamento de quórum e baixa executada ponta a ponta |

## O que este protótipo não demonstra

1. **Operação distribuída.** Um nó EVM em processo no lugar de quatro
   validadores Besu/QBFT (ADR-0008). Não há prova sobre consenso, finalidade
   multi-nó nem — o mais relevante — privacidade de rede, que é onde o Besu foi
   descontinuado no piloto do Drex.
2. **Isolamento físico das bases.** Três bancos e três credenciais no mesmo
   cluster. O comprometimento da base operacional alcançaria o cofre de PII
   neste ambiente; na arquitetura, não.
3. **Integração com registradora real.** Seis premissas embutidas no simulador
   estão declaradas no ADR-0006, e quatro dos catorze tipos de divergência
   dependem delas. Confirmá-las é a primeira pergunta do piloto.
4. **Portões G2 e G3.** Não foram executados. E2, E3, E5, E4 e E7 não emitiram
   parecer sobre o que foi construído. O que existe são os testes que a própria
   construção escreveu — e G1 mostrou que isso não basta: três revisores
   independentes encontraram defeitos que os meus testes declaravam cobertos.
5. **Teste de usabilidade.** O aceite de W6 pede roteiro concluído sem
   assistência por pessoa real. O que há é verificação automática de jargão e
   contagem de decisões.
6. **Upgradeability em proxy real.** O timelock e a proposta existem e são
   testados; os contratos não estão atrás de um proxy ERC-1967 implantado.

## Dívidas conhecidas

- Quatro vulnerabilidades de dependência em produção (nenhuma crítica). A
  restante de severidade alta vem do `postcss` na cadeia de build do Next e
  exige mudança quebrante.
- `ops.reacao_credor` não tem rota de escrita na interface — só de leitura.
- A reavaliação contínua do selo EUDR existe como rota, não como agenda.
- O simulador de registradora e o gerador de massa não têm testes próprios.

## Mudanças de contrato aplicadas

Onze solicitações (SMC-001 a SMC-011) em `docs/contracts/MUDANCAS.md`. Oito
vieram dos achados do painel em G1; três surgiram durante a construção, e as
três valem menção porque não apareceriam em revisão de código:

- **SMC-009 e SMC-010:** a margem que separa conformidade de incerteza no
  cruzamento EUDR era constante arbitrada; passou a derivar da resolução da
  base e do perímetro do talhão.
- **SMC-011:** o LTV estava limitado a 100% pelo domínio, o que tornava
  irrepresentável o colateral insuficiente. Descoberto executando a
  demonstração, não lendo o código.
