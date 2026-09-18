# Solicitações de mudança de contrato

`docs/contracts/` e `contracts/interfaces/` são congelados desde o fim da Fase
0. Congelado não quer dizer errado para sempre: quer dizer que muda por
processo, com quem depende sabendo antes.

## Como abrir

Acrescente uma seção ao fim deste arquivo, no PR que propõe a mudança:

```
## SMC-NNN — título curto
- Solicitante: A?
- Artefato: caminho do arquivo e do elemento (rota, tabela, campo, evento)
- Motivo: o que quebrou ou o que faltou. Não "seria melhor se".
- Impacto: quais agentes precisam mudar código, e o que exatamente.
- Compatibilidade: aditiva | quebrante. Se quebrante, plano de transição.
- Princípios tocados: P1..P7, e como seguem respeitados.
- Decisão: (preenchida pelo orquestrador) aceita | recusada | adiada para G?
```

## Regras

1. Mudança **aditiva** (campo opcional novo, rota nova, valor novo em enum de
   saída) pode ser aprovada pelo orquestrador dentro da fase.
2. Mudança **quebrante** só entra em ponto de sincronização de contratos, ao
   fim da fase, e exige ADR.
3. Mudança que afeta P1, P2, P3 ou P7 exige parecer do especialista com veto
   sobre aquele princípio, mesmo fora de portão.
4. Enquanto a SMC não for decidida, quem solicitou **não** implementa contra a
   mudança pretendida. Implementar na expectativa de aprovação é como o
   paralelismo sem contrato congelado falha.

## Registro

A Fase 0 congelou os artefatos em 2026-09-18. As solicitações abaixo decorrem
dos achados do portão G1 e foram decididas pelo orquestrador na Fase 0.1, antes
de qualquer implementação — precisamente para não virarem mudança de contrato
em sete frentes paralelas depois.

## SMC-001 — Saída do congelamento deixa de ser uma string
- Solicitante: orquestrador (achado do red team, ataque nº 2, reproduzido)
- Artefato: `ops.contrato_transicao`, `ops.fn_bloqueia_congelado`, `ops.fn_valida_transicao`, `ops.divergencia`
- Motivo: bastava escrever `divergencia_reconciliada` na coluna de guarda para
  destrancar o congelamento — sem divergência reconciliada, sem operador humano
  e com `ator_ref` nulo. O teste que se anunciava como prova de P1 usava outra
  guarda e comemorava a recusa; a string que destrancava nunca era tentada.
- Impacto: A2 passa a informar `divergencia_id`, `ator_tipo` e `ator_ref` na
  transição de saída; a guarda passa a ser validada contra o grafo.
- Compatibilidade: quebrante. Nenhuma implementação existia.
- Princípios: P1 e P5, agora executáveis. Teste executa o ataque e exige recusa.
- Decisão: **aceita**.

## SMC-002 — Quórum exigido também no ramo degradado
- Solicitante: orquestrador (achado de E6 A3 e do red team nº 4, reproduzido)
- Artefato: `ops.fn_valida_uso_leitura`, novo `ops.fn_valida_quorum_leitura`
- Motivo: leitura `DEGRADADA` com uma fonte independente sustentava decisão
  contratual, com caminho aberto até o gatilho de LTV e a excussão, embora o
  ADR-0003 afirmasse o contrário. Degradar pode reduzir o número total de
  fontes; nunca a redundância independente.
- Impacto: A3 passa a respeitar a política ao promover leitura; A2 recebe recusa
  quando tenta consumir leitura fora do quórum ou expirada.
- Compatibilidade: quebrante.
- Princípios: P4. Teste executa o ataque e exige recusa.
- Decisão: **aceita**.

## SMC-003 — Verificação de P7 alcança o código-fonte
- Solicitante: orquestrador (achado de E1 A4 e do red team nº 1)
- Artefato: novo `infra/ci/validar-p7.mjs`; `package.json`; `CLAUDE.md`
- Motivo: a verificação de P7 alcançava seis interfaces Solidity e não os
  serviços, onde novação, interposição e promessa de rendimento de fato
  ocorreriam. A afirmação do `CLAUDE.md` era verdadeira para as interfaces e
  falsa para o resto.
- Impacto: todos os agentes. Varredura de identificadores e de texto exibido
  sobre `services/`, `apps/`, `contracts/` e `infra/`.
- Compatibilidade: aditiva.
- Princípios: P7 e P1.
- Decisão: **aceita**.

## SMC-004 — Catálogo passa a enxergar o sentido token→registro e a má notícia
- Solicitante: orquestrador (achados de E1 A1 e do red team nº 5)
- Artefato: `ops.tipo_divergencia`, `ops.politica_divergencia`, `comum.yaml`,
  `payloads.schema.json`, `catalogo.json`
- Motivo: a fração podia circular on-chain sem cessão registrada e a conciliação
  era cega a isso; e o catálogo tinha canal para a boa notícia e nenhum para
  selo revogado, DDS revogada ou participante desabilitado.
- Impacto: A1 emite evento de titularidade; A2 detecta os dois novos tipos; A4 e
  A5 emitem os eventos de revogação e desabilitação.
- Compatibilidade: aditiva nos enums de saída, quebrante no contrato de eventos.
- Princípios: P1, P5, P7.
- Decisão: **aceita**.

## SMC-005 — Timelock ganha proposta
- Solicitante: orquestrador (achado do red team nº 3)
- Artefato: `IControleAcesso.sol` e ABI congelada
- Motivo: o timelock existia como evento e getter; `conceder` era chamada única
  e imediata. A garantia estava no NatSpec, não no código.
- Impacto: A1 implementa `propor`, `executarProposta`, `cancelarProposta`.
- Compatibilidade: aditiva na interface.
- Princípios: P7 e P1.
- Decisão: **aceita**.

## SMC-006 — Garantia real ganha oponibilidade
- Solicitante: orquestrador (achado de E1 A5)
- Artefato: `ops.garantia`
- Motivo: o waterfall atribuía cap, deságio e prazo a níveis cujo grau de
  oponibilidade não era representável — simulando como colateral o que, na
  execução, pode ser papel.
- Impacto: A2 passa a exigir averbação para garantia real em nível 1 ou 2.
- Compatibilidade: quebrante.
- Princípios: coerência de risco (mandato de E4).
- Decisão: **aceita**.

## SMC-007 — Instrumentação de custo
- Solicitante: orquestrador (achado de E6 A1)
- Artefato: novo `ops.custo_verificacao`, `ops.reacao_credor` e visões
- Motivo: seis das oito lacunas da Seção 1.1 são de custo ou disposição a pagar,
  e o repositório tinha um único placar — o da conciliação. O dossiê de G4
  poderia responder de forma verificável sobre F3 e teria de narrar as demais.
- Impacto: A5, A4 e A3 registram custo na etapa em que ele ocorre; A6 registra
  reação revelada de credor.
- Compatibilidade: aditiva.
- Princípios: propósito do MVP (Seção 1).
- Decisão: **aceita**.

## SMC-008 — ADRs ausentes
- Solicitante: orquestrador (achados de E1 A3, E6 A2 e red team nº 3)
- Artefato: `docs/adr/0005`, `0006`, `0007`, `0008`
- Motivo: a regra do próprio projeto diz que não há decisão não registrada, e as
  três decisões mais consequentes não estavam registradas.
- Compatibilidade: documental.
- Decisão: **aceita**.

## SMC-009 — Geometria das bases de desmatamento no banco
- Solicitante: A4
- Artefato: `geo.desmatamento` em `docs/contracts/db/ops/070_eudr.sql`
- Motivo: o cruzamento do polígono do talhão com as bases precisa ser feito
  pelo PostGIS. Cruzamento em memória do serviço não é auditável nem
  reproduzível, e a evidência de conformidade deixaria de sê-lo.
- Impacto: A4 ingere as bases; A7 carrega a massa sintética.
- Compatibilidade: aditiva.
- Princípios: P5 e P6.
- Decisão: **aceita**.

## SMC-010 — Resolução espacial como coluna da base de referência
- Solicitante: A4
- Artefato: `ops.base_referencia_geo.resolucao_m`
- Motivo: a faixa de incerteza do cruzamento estava como constante de código
  (0,5 ha). Ela depende da resolução da base e do perímetro do talhão, porque o
  erro mora nas bordas. Constante escolhida a dedo classifica como conforme o
  que é apenas indistinguível — o falso conforme que contamina o colateral.
- Impacto: A4 calcula a margem por talhão e base; A7 carrega a resolução.
- Compatibilidade: aditiva, com padrão de 30 m.
- Princípios: coerência da evidência (mandato de E5).
- Decisão: **aceita**.
