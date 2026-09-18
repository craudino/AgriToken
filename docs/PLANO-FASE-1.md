# Plano de construção — da decisão de G1 ao protótipo ponta a ponta

**Data:** 2026-09-18 · **Autor:** orquestrador
**Gatilho:** decisão humana de prosseguir após o portão G1

## 0. Como este plano trata o resultado de G1

E1 reprovou; E6 aprovou com ressalvas; o red team reproduziu quatro ataques. A
decisão humana foi prosseguir. Isso não apaga os achados — apaga a discussão
sobre parar. Por conseguinte, a construção começa por uma fase curta e fechada
de correções (Fase 0.1), porque os dois defeitos reproduzidos estão em
**artefato congelado**: se sete frentes começarem sobre eles, cada correção
vira mudança de contrato em sete lugares.

Ordem de precedência que rege todo este plano: **corrigir contrato quebrado >
construir sobre contrato íntegro > acrescentar capacidade.**

## 1. Fase 0.1 — correções bloqueantes (orquestrador)

Lista fechada. Nada além disto entra antes da implementação.

| # | Correção | Origem | Prova de que foi corrigido |
|---|---|---|---|
| C1 | Congelamento deixa de ser destrancável por string: transição de saída exige FK para divergência efetivamente reconciliada, com operador humano | Red team #2 (reproduzido) | Teste que executa a string de ataque e exige recusa |
| C2 | Leitura contratual passa a exigir o quórum da política vigente, inclusive no ramo `DEGRADADA` | E6 A3 e red team #4 (reproduzido) | Teste que tenta consumir leitura degradada de uma fonte e exige recusa |
| C3 | Teste de P7 passa a varrer `services/` e `apps/`, não só as interfaces | E1 A4 e red team #1 | Varredura falha ao encontrar padrão proibido em qualquer fonte |
| C4 | Divergência no sentido token→registro entra no catálogo; eventos de má notícia passam a existir | E1 A1 e red team #5 | Catálogo cobre os dois sentidos; validador exige evidência nas transições adversas |
| C5 | Timelock ganha função de proposta; papéis sensíveis deixam de ser concedidos por chamada única | Red team #3 | ABI congelada com `propor`/`executar` e prazo verificável |
| C6 | Garantia real ganha estado e data de averbação (oponibilidade) | E1 A5 | Coluna obrigatória para garantia real; waterfall lê oponibilidade |
| C7 | Instrumentação de custo: esforço e custo de verificação passam a ser campos | E6 A1 | F1 e F4 com placar, não narrativa |
| C8 | Três ADRs ausentes: perímetro regulatório, premissas da registradora, tensão P1×P7 | E1 A3, E6 A2, red team #3 | ADR-0005, 0006 e 0007 |

## 2. Ordem de execução dos agentes

Não é a ordem do briefing por preguiça: é a ordem das dependências reais.
Cada agente só começa quando o contrato de quem ele consome está de pé.

```
A7 ──► A1 ──► A5 ──► A3 ──► A2 ──► A4 ──► A6 ──► integração
```

| Passo | Agente | Por que nesta posição | Entrega |
|---|---|---|---|
| 1 | **A7 Plataforma** | Ninguém testa nada sem ambiente, banco e dados sintéticos | Workspace, migrações aplicadas, gerador de massa, runner único |
| 2 | **A1 Chain** | O espelho é pré-requisito de A2; e contrato é o que leva mais tempo para ficar seguro | Contratos Solidity implementados, nó EVM local, invariantes |
| 3 | **A5 Compliance** | A2 não origina sem `habilitado_a_originar`; é a porta do dado pessoal | Cofre de PII, KYC, crypto-shredding, referência opaca |
| 4 | **A3 Oráculos** | A2 e A4 dependem de leitura com quórum | Adaptadores, quórum, disputa, linhagem, degradação |
| 5 | **A2 Core** | Depende de A1, A5 e A3; entrega a lacuna nº 1 | Máquina de estados, originação, conciliação, waterfall |
| 6 | **A4 EUDR & Geo** | Depende de A3 (quórum geoespacial) e alimenta o selo de A2 | Polígonos, evidência, DDS, reavaliação |
| 7 | **A6 Interfaces** | Depende de todas as APIs de pé | Fluxo do produtor, painel do comprador, painel de auditoria |
| 8 | Integração | — | Demonstração ponta a ponta e cenário de estresse |

## 3. Desvios de stack assumidos, e por quê

O ambiente desta sessão não tem Docker. Dois desvios, ambos registrados em ADR
antes de serem usados, porque desvio silencioso de stack é o tipo de dívida que
aparece no piloto:

1. **Rede distribuída:** em vez de quatro validadores Besu/QBFT em Docker
   Compose, um nó EVM local em processo. A camada de contrato é idêntica
   (mesma EVM, mesmo bytecode); o que se perde é o teste de consenso e de
   finalidade multi-nó. O ADR-0001 já previa a revisão; este desvio não o
   revoga, apenas registra o que o protótipo **não** demonstra.
2. **Bases de dados:** as três bases rodam em um cluster PostgreSQL local, em
   bancos distintos com papéis distintos. A separação **física** exigida pelo
   ADR-0002 fica demonstrada na configuração, não na topologia. É desvio de
   ambiente de desenvolvimento, não de arquitetura.

## 4. Definição de pronto do protótipo

Uma execução única, sem intervenção manual, que percorra: onboarding com KYC →
ingestão de polígono e evidência EUDR → originação → registro no simulador →
espelhamento on-chain → conciliação conforme → marcação a mercado com quórum →
**injeção das doze divergências e detecção das doze, com latência medida** →
congelamento → reconciliação humana → inadimplência → waterfall → liquidação
com baixa. Mais: varredura de PII limpa, eliminação de titular com comprovante,
e as três telas navegáveis.
