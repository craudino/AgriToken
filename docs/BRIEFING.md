# BRIEFING MESTRE DE ENGENHARIA — MVP CPR DIGITAL
### Documento de especificação e orquestração para execução pelo Claude Code
**Versão 1.0 — Setembro de 2026 — Classificação: Restrito**

---

## 0. COMO USAR ESTE DOCUMENTO

Este é um documento operacional, não um plano de negócios. Ele traduz o escopo funcional mínimo já definido no plano de negócios preliminar (v2) em um plano de construção executável, desenhado para ser consumido por uma sessão do Claude Code operando com múltiplos agentes em paralelo e submetido, a cada portão, a um painel de especialistas.

A sequência de uso é a seguinte. Primeiro, salve este arquivo na raiz do repositório como `docs/BRIEFING.md` e gere o `CLAUDE.md` a partir da Seção 9. Em seguida, execute a Fase 0 (contratos), que é estritamente sequencial e da qual depende todo o paralelismo posterior. Só então dispare as Fases 1 e 2, que são paralelas por construção. Não inverta essa ordem: o paralelismo sem contratos congelados produz retrabalho em cascata, e o custo de reconciliar interfaces divergentes entre seis agentes excede com folga o tempo economizado.

---

## 1. OBJETIVO E TESE DE ENGENHARIA

O MVP não é uma prova de que "dá para tokenizar". Isso já está provado no mercado. O MVP é um **instrumento de compra de informação sob incerteza** — na lógica do Valor da Informação — e sua arquitetura deve refletir essa finalidade. Por conseguinte, cada módulo existe para resolver uma lacuna informacional específica identificada no plano de negócios, e não para exibir sofisticação técnica.

A tese de engenharia decorre diretamente da tese econômica. Se a plataforma é uma estrutura de governança híbrida cuja função é reduzir custos de mensuração, de transação e de enforcement, então o software precisa demonstrar, de forma verificável e auditável, que:

**Primeiro**, o espelho digital jamais diverge do título registrado — a conciliação entre o registro na entidade autorizada e o estado on-chain é contínua, detectável e reconciliável, e o registro sempre prevalece. Esta é a lacuna de maior valor informacional do MVP: se a conciliação falhar, toda a arquitetura jurídica de espelhamento cai.

**Segundo**, a verificação de atributos custosos de mensurar (polígono, conformidade ambiental, preço, entrega, pagamento) pode ser automatizada com redundância suficiente para que o credor confie nela — o que exige governança de oráculos, não apenas integração de APIs.

**Terceiro**, a conformidade regulatória não é uma camada aplicada ao final, mas uma propriedade estrutural do sistema — a separação on-chain/off-chain, a pseudonimização e a trilha de auditoria precisam ser demonstráveis a um regulador em uma sessão de tela.

Destarte, o critério último de sucesso do MVP não é "o sistema funciona", mas "o sistema produz evidência que altera uma decisão de investimento". Todo artefato deve ser construído com esse teste em mente.

### 1.1 Escopo funcional mínimo (o que entra)

| # | Capacidade | Lacuna informacional que resolve |
|---|---|---|
| F1 | Onboarding e KYC/KYB com captura automática de CAR/SICAR | Custo real de verificação por produtor |
| F2 | Originação e espelhamento da CPR registrada (ERC-3525) | Viabilidade técnica e jurídica do espelho |
| F3 | Conciliação contínua registro ↔ token, com registro prevalecente | **Lacuna crítica nº 1** |
| F4 | Motor de conformidade EUDR (polígono → evidência → DDS) | Custo e viabilidade do selo como atributo do colateral |
| F5 | Marcação a mercado via oráculo de preço | Pró-ciclicidade da receita e do colateral |
| F6 | Trilha de garantias e simulação do waterfall de cinco níveis | Executoriedade e calibração do fundo |
| F7 | Painel do comprador de risco (evidência e auditoria) | Disposição a pagar do lado credor |
| F8 | Liquidação com baixa automática e conciliação de pagamento | Fechamento do ciclo contratual |

### 1.2 Fora de escopo (explicitamente)

Mercado secundário com negociação pulverizada; custódia de ativos virtuais de terceiros; carteira própria de criptoativos; integração produtiva com registradora (usar simulador conforme Seção 6.2); motor de crédito com scoring proprietário treinado (usar heurística parametrizável); aplicativo móvel nativo; multi-commodity além de café; qualquer funcionalidade que desloque a plataforma para o perímetro de PSAV ou de contraparte central.

> **Regra de ouro de escopo:** se um agente propuser uma funcionalidade que não mapeie para uma lacuna informacional da tabela acima, a proposta é rejeitada por padrão. A disciplina de escopo é a principal defesa contra o esgotamento do runway.

---

## 2. PRINCÍPIOS ARQUITETURAIS INEGOCIÁVEIS

Estes princípios têm precedência sobre conveniência de implementação. Um agente que precise violá-los deve parar e escalar ao painel, não contornar.

**P1 — O registro prevalece.** O token é representação, nunca fonte de verdade. Em qualquer divergência entre o registro na entidade autorizada e o estado on-chain, o sistema sinaliza, congela operações sobre aquele contrato e exige reconciliação humana. Nunca "corrige" o registro a partir do token.

**P2 — Dado pessoal não toca a cadeia.** Nenhum CPF, nome, dado bancário ou polígono georreferenciado bruto vai on-chain, em nenhuma circunstância, nem em campo de metadados, nem em evento, nem em calldata. On-chain circulam apenas identificadores opacos, hashes e provas. Esta é uma restrição de conformidade com a LGPD, não uma preferência de design: a imutabilidade da cadeia é incompatível com o direito à eliminação.

**P3 — Unicidade do colateral.** O sistema deve tornar estruturalmente impossível mobilizar duas vezes a mesma garantia. Ancoragem no identificador único de registro, com verificação idempotente na emissão.

**P4 — Redundância de oráculo por padrão.** Nenhuma decisão contratual materialmente relevante pode depender de uma única fonte externa. Toda leitura crítica exige quórum mínimo de duas fontes e possui caminho de disputa.

**P5 — Auditabilidade completa.** Todo evento de estado gera registro imutável, com timestamp, origem, autor e evidência. O sistema deve conseguir responder, para qualquer contrato e qualquer instante, à pergunta "o que se sabia, quando se soube e com base em quê".

**P6 — Determinismo e reprodutibilidade.** Nenhuma lógica contratual pode depender de fonte não determinística on-chain. Toda execução deve ser reproduzível a partir do log.

**P7 — Fronteira regulatória codificada.** O sistema não executa novação, não se interpõe como contraparte, não custodia ativo virtual de terceiro e não promete rendimento. Estas proibições devem existir como testes automatizados que falham se a fronteira for cruzada — não apenas como recomendação em documento.

---

## 3. O PAINEL DE ESPECIALISTAS

O painel é o mecanismo central de qualidade deste projeto e a razão de ele não ser apenas mais um repositório de código. Trata-se de instanciar, como subagentes com instruções próprias e memória separada, um conjunto de perspectivas profissionais adversariais que revisam os artefatos antes de cada portão. O princípio é o da mitigação deliberada de vieses: o agente que constrói não é o agente que avalia, e cada especialista tem um viés declarado e um poder de veto delimitado.

Cada especialista recebe um arquivo de instrução em `.claude/agents/` e é invocado nos momentos definidos na Seção 8. Nenhum portão é atravessado sem parecer escrito dos especialistas com veto naquele portão.

### 3.1 Composição do painel

**E1 — Jurista regulatório (CVM/BCB).** *Viés declarado:* assume que a plataforma será fiscalizada e desenha para sobreviver a isso. *Mandato:* verificar que nenhuma funcionalidade desloca a empresa para o perímetro de valor mobiliário, de PSAV ou de contraparte central. *Veto em:* G1, G3, G4. *Pergunta-guia:* "se um fiscal abrir esta tela amanhã, o que ele conclui que estamos fazendo?"

**E2 — Especialista em privacidade e proteção de dados.** *Viés declarado:* trata todo dado como tóxico até prova em contrário. *Mandato:* auditar a fronteira on-chain/off-chain, a pseudonimização, o crypto-shredding e a base legal de cada tratamento. *Veto em:* G2, G3, G4. *Pergunta-guia:* "se precisarmos eliminar este titular amanhã, conseguimos?"

**E3 — Engenheiro de contratos inteligentes e segurança.** *Viés declarado:* presume que todo contrato será atacado. *Mandato:* revisão de segurança dos contratos (reentrância, controle de acesso, upgradeability, integer safety, front-running), qualidade dos testes e cobertura de invariantes. *Veto em:* G2, G3. *Pergunta-guia:* "qual é o caminho mais barato para roubar ou travar valor aqui?"

**E4 — Especialista em crédito e risco agrícola.** *Viés declarado:* cético quanto a garantias no papel. *Mandato:* validar a modelagem do waterfall, a marcação a mercado, a lógica de gatilhos de inadimplência e a coerência entre prêmio de risco e capitalização. *Veto em:* G3, G4. *Pergunta-guia:* "na safra ruim, com preço em queda, este mecanismo ainda funciona?"

**E5 — Arquiteto de dados e geoespacial.** *Viés declarado:* assume que todo dado externo está desatualizado ou errado. *Mandato:* modelagem geoespacial, qualidade de polígonos, governança e redundância de oráculos, linhagem de dados. *Veto em:* G2, G3. *Pergunta-guia:* "de onde veio este número e o que acontece se a fonte cair?"

**E6 — Economista institucional.** *Viés declarado:* desconfia de soluções técnicas para problemas de incentivo. *Mandato:* verificar que cada funcionalidade efetivamente reduz custo de transação, mensuração ou enforcement, e que os incentivos dos agentes permanecem alinhados. *Veto em:* G1, G4. *Pergunta-guia:* "que custo de transação isto elimina, e para quem?"

**E7 — Designer de produto e fricção cognitiva.** *Viés declarado:* assume que o produtor rural abandona qualquer fluxo com mais de três etapas. *Mandato:* garantir que as decisões do produtor operem como decisões programadas, de baixa carga cognitiva, e que as do investidor ofereçam suporte deliberativo. *Veto em:* G3. *Pergunta-guia:* "quantas decisões estamos pedindo a quem não quer decidir?"

**E8 — Engenheiro de confiabilidade (SRE).** *Viés declarado:* presume falha de tudo o que é externo. *Mandato:* observabilidade, degradação graciosa, tolerância a indisponibilidade de oráculo, recuperação de desastre. *Veto em:* G4. *Pergunta-guia:* "o que acontece às três da manhã quando esta integração cair?"

### 3.2 Protocolo de deliberação do painel

O painel não delibera por consenso, e isso é deliberado: consenso prematuro é o mecanismo pelo qual o viés de hierarquia — a deferência ao membro mais sênior ou mais assertivo — contamina decisões técnicas. O protocolo é o seguinte.

**Passo 1 — Parecer independente e simultâneo.** Cada especialista com veto no portão produz seu parecer **sem ver o parecer dos demais**. Isto é essencial e deve ser respeitado na orquestração: os subagentes são invocados em paralelo, com contexto isolado. Formato do parecer: veredicto (Aprovado / Aprovado com ressalvas / Reprovado), até cinco achados ordenados por severidade, e para cada achado a evidência específica (arquivo, linha, teste).

**Passo 2 — Consolidação e conflito explícito.** Um agente orquestrador consolida os pareceres e **destaca os conflitos em vez de suavizá-los**. Onde dois especialistas divergem, a divergência vai para a decisão humana com os dois argumentos íntegros.

**Passo 3 — Premortem obrigatório.** Antes de cada portão maior (G3 e G4), o painel executa um premortem: "estamos doze meses à frente e o MVP falhou publicamente; escreva a autópsia". Cada especialista escreve a sua. Este exercício é o antídoto mais eficaz contra o excesso de otimismo do construtor.

**Passo 4 — Red team no portão regulatório.** Em G1 e G4, um agente adicional assume explicitamente o papel de adversário — um fiscal hostil, um advogado da contraparte em disputa — e tenta demolir a estrutura. O parecer do red team entra no dossiê do portão.

**Passo 5 — Registro de decisão.** Toda decisão de portão gera um ADR (Architecture Decision Record) em `docs/adr/`, com contexto, alternativas consideradas, decisão, consequências e quem vetou o quê. Não há decisão não registrada.

> **Regra antiviés:** sempre que um especialista invocar um precedente ("no projeto X isso funcionou"), o orquestrador deve fazer a pergunta de controle de contexto: *"isso era verdade em que contexto, e esse contexto vale aqui?"* Este é o antídoto ao viés de disponibilidade e deve ser aplicado sem exceção.

---

## 4. ORQUESTRAÇÃO MULTIAGENTE

### 4.1 Princípio de decomposição

O paralelismo só é seguro depois que as interfaces estão congeladas. Por conseguinte, a decomposição segue a lógica de **contratos primeiro, implementação depois**: a Fase 0 produz o esquema de dados, a especificação OpenAPI, as ABIs dos contratos e os esquemas de evento; somente após o congelamento desses artefatos os agentes de construção podem operar sem se pisarem.

A fronteira entre agentes é desenhada para minimizar acoplamento e, portanto, conflito de merge. Cada agente é dono exclusivo de um conjunto de diretórios e não escreve fora deles; integrações atravessam fronteiras apenas por contratos versionados.

### 4.2 Agentes de construção (executados em paralelo)

| Agente | Domínio | Diretórios exclusivos | Depende de |
|---|---|---|---|
| **A1 — Chain** | Contratos ERC-3525, âncora de registro, cofre de garantias, controle de acesso | `contracts/`, `test/chain/` | ABIs (Fase 0) |
| **A2 — Core** | Domínio, originação, máquina de estados do contrato, conciliação registro↔token | `services/core/` | OpenAPI, esquema |
| **A3 — Oráculos** | Adaptadores, quórum, cache, disputa, linhagem | `services/oracle/` | Esquema de evento |
| **A4 — EUDR & Geo** | Polígonos, cruzamento de desmatamento, geração de evidência e DDS | `services/eudr/` | Esquema geoespacial |
| **A5 — Compliance** | KYC/KYB/AML, LGPD, DID/VC, cofre de PII, crypto-shredding | `services/compliance/` | Esquema, OpenAPI |
| **A6 — Interfaces** | Painel do comprador de risco, fluxo do produtor, painel de auditoria | `apps/web/` | OpenAPI |
| **A7 — Plataforma** | Infra, CI/CD, observabilidade, ambientes, dados sintéticos | `infra/`, `.github/` | — |

### 4.3 Mecânica de execução no Claude Code

Recomenda-se **git worktrees** — um por agente — de modo que cada agente opere em uma árvore de trabalho isolada, com branch própria, evitando disputa pelo estado do diretório. A integração é feita por pull requests contra `develop`, com CI obrigatório.

```bash
# Fase 0 concluída e contratos congelados em main
for a in chain core oracle eudr compliance web platform; do
  git worktree add ../mvp-$a feat/$a
done
```

Cada worktree recebe uma sessão do Claude Code com o mesmo `CLAUDE.md` raiz e um `AGENT.md` local que define o mandato, as fronteiras e a definição de pronto daquele agente. A regra operacional é rígida: **um agente que precise alterar arquivo fora de seus diretórios abre uma solicitação de mudança de contrato, não edita diretamente.**

### 4.4 Cadência de sincronização

Rebase diário contra `develop`; integração por PR ao final de cada workstream; e um **ponto de sincronização de contratos** ao final de cada fase, no qual o orquestrador verifica que nenhuma implementação divergiu silenciosamente da especificação. Divergências detectadas tarde são a principal fonte de retrabalho em construção paralela.

---

## 5. STACK TÉCNICA

A escolha privilegia maturidade, auditabilidade e velocidade de prova, não elegância.

**Camada distribuída.** Rede permissionada Hyperledger Besu com consenso QBFT, quatro nós validadores em Docker Compose para desenvolvimento. Registre-se, com honestidade técnica, que o Banco Central descontinuou o Besu no piloto Drex justamente por limitações de privacidade e desempenho; a escolha permanece defensável para uma rede privada de consórcio com volume baixo e validadores conhecidos, mas deve ser tratada como decisão sob revisão contínua, com um ADR explícito registrando os critérios que disparariam sua substituição. A camada de privacidade é a que exige maior investimento de engenharia — é onde o Drex tropeçou.

**Contratos.** Solidity, com implementação do padrão ERC-3525 (semi-fungível) para representação de contratos fracionáveis. Ferramental: Foundry para testes de propriedade e fuzzing, Hardhat para deploy e scripts. Cobertura mínima de 90% em contratos e testes de invariantes obrigatórios.

**Backend.** TypeScript com NestJS, organizado por domínio (não por camada técnica). PostgreSQL com PostGIS para dados geoespaciais. Redis para cache de oráculo. Filas assíncronas para reconciliação e ingestão. Separação física entre a base de PII e a base operacional, com chaves de criptografia por titular.

**Frontend.** Next.js com TypeScript, duas superfícies distintas: o fluxo do produtor, otimizado para fricção mínima e decisão programada, e o painel do comprador de risco, otimizado para evidência, rastreabilidade e suporte à deliberação.

**Identidade.** Implementação das normas W3C de Identidade Descentralizada (DID) e Credenciais Verificáveis para KYC portátil e certificações.

**Criptografia de privacidade.** Provas de conhecimento zero (zk-SNARKs) para comprovação de conformidade sem exposição de localização. Para o MVP, aceita-se um circuito mínimo e bem delimitado — provar que um polígono pertence a um conjunto de polígonos conformes sem revelar qual — em vez de uma biblioteca genérica. O risco de superengenharia aqui é alto e deve ser contido pelo painel.

**Observabilidade.** OpenTelemetry, logs estruturados, trilha de auditoria imutável em armazenamento append-only separado da base operacional.

---

## 6. MODELO DE DOMÍNIO E DECISÕES DE DADOS

### 6.1 Entidades centrais

O núcleo do domínio é o **Contrato Espelhado**, que carrega: identificador de registro na entidade autorizada (fonte de verdade), identificador de token, produtor (referência opaca), commodity, quantidade, safra, vencimento, valor de face, valor marcado a mercado, estado do ciclo de vida, conjunto de garantias vinculadas, selo EUDR e situação de conciliação.

O ciclo de vida é uma máquina de estados explícita e auditável: `RASCUNHO → EM_VERIFICACAO → REGISTRADO → ESPELHADO → ATIVO → (EM_DISPUTA | INADIMPLENTE) → LIQUIDADO | EXECUTADO`. Toda transição gera evento assinado. Transições inválidas são rejeitadas no domínio, não apenas na interface.

Além dele: **Produtor** (com PII isolada), **Talhão** (polígono, CAR, histórico de conformidade), **Garantia** (tipo, nível no waterfall, estado de excussão), **Leitura de Oráculo** (fonte, valor, timestamp, quórum, disputa), **Evidência EUDR** (polígono, base cruzada, data de corte, resultado, hash) e **Registro de Auditoria**.

### 6.2 Simulação da registradora

Não há integração produtiva com registradora no MVP. Construa um **simulador de registradora** com interface idêntica à que se espera da integração real, que permita injetar deliberadamente divergências (título baixado, cessão não refletida, alteração de valor). A capacidade de **detectar divergência injetada** é o teste de aceitação mais importante do MVP inteiro — é ele que resolve a lacuna informacional nº 1.

### 6.3 Dados sintéticos

Gerar um conjunto sintético realista: dezenas de produtores com distribuição de porte compatível com a cafeicultura do Sul de Minas (predominância de pequenas propriedades), polígonos reais em geometria mas anonimizados em localização, série histórica de preço, e cenários de safra incluindo quebra e queda de preço simultâneas — o cenário que mais estressa a arquitetura, por atingir receita e colateral ao mesmo tempo.

---

## 7. ESPECIFICAÇÃO DOS WORKSTREAMS

Cada workstream abaixo é atribuído a um agente e possui critérios de aceite verificáveis. Um workstream não está pronto até que seus critérios passem em CI e o especialista com veto emita parecer.

### W1 — Contratos on-chain (A1)
Implementar o token de espelho ERC-3525 com ancoragem no identificador de registro e garantia de unicidade idempotente; o cofre de garantias com os cinco níveis do waterfall parametrizáveis; controle de acesso por papéis; e mecanismo de congelamento acionado por divergência de conciliação.
*Aceite:* cobertura ≥90%; invariantes provadas por fuzzing (nunca há dois tokens ativos para o mesmo registro; a soma das frações jamais excede o total; nenhum caminho de código executa novação); relatório de segurança de E3 sem achado crítico.

### W2 — Núcleo de domínio e conciliação (A2)
Máquina de estados do contrato; motor de originação; e o **serviço de conciliação contínua**, que compara periodicamente o estado do registro com o estado on-chain, classifica divergências por severidade, congela o contrato e abre incidente.
*Aceite:* o simulador injeta dez tipos de divergência e o sistema detecta os dez, com tempo de detecção medido e registrado; nenhuma correção automática do registro a partir do token.

### W3 — Oráculos com governança (A3)
Adaptadores para preço, geoespacial, fiscal, climático e pagamento; camada de quórum com política configurável por tipo de leitura; cache com política de expiração; caminho de disputa que suspende o efeito contratual da leitura contestada; linhagem completa de cada dado.
*Aceite:* com uma fonte derrubada, o sistema degrada graciosamente e sinaliza, sem produzir decisão contratual baseada em fonte única; toda leitura é rastreável até a origem.

### W4 — Motor EUDR e geoespacial (A4)
Ingestão de polígono, validação topológica, cruzamento com base de desmatamento contra a data de corte de 31 de dezembro de 2020, geração de evidência com hash, emissão de declaração de due diligence e reavaliação contínua.
*Aceite:* conjunto de polígonos de teste com casos conformes, não conformes e limítrofes classificados corretamente; evidência reproduzível a partir do hash; nenhum polígono bruto persistido on-chain.

### W5 — Compliance e privacidade (A5)
KYC/KYB com verificação de CAR/SICAR, listas restritivas, PEP, embargos ambientais e lista suja de trabalho escravo; cofre de PII com chave por titular; crypto-shredding; emissão de credenciais verificáveis; registro de operações de tratamento.
*Aceite:* teste automatizado que varre toda a cadeia em busca de padrões de PII e falha se encontrar qualquer um; execução completa de um pedido de eliminação de titular com evidência de irreversibilidade; parecer de E2 sem achado crítico.

### W6 — Interfaces (A6)
Fluxo do produtor em no máximo três etapas decisórias, com linguagem sem jargão; painel do comprador de risco com evidência, trilha e estado de conciliação em primeiro plano; painel de auditoria para demonstração a regulador.
*Aceite:* teste de usabilidade com roteiro de tarefa concluído sem assistência; o painel de auditoria responde, para um contrato qualquer, "o que se sabia, quando e com base em quê" em menos de três cliques.

### W7 — Plataforma e confiabilidade (A7)
Ambientes reproduzíveis, CI com portões de qualidade e segurança, observabilidade ponta a ponta, geração de dados sintéticos, e o cenário de estresse de safra ruim com preço em queda.
*Aceite:* ambiente sobe do zero por comando único; cenário de estresse executa e produz relatório; alertas disparam nos casos previstos.

### W8 — Simulação do waterfall (A2 + A4 de crédito, sob E4)
Motor de simulação que, dado um cenário de inadimplência, percorre os cinco níveis de absorção e produz o resultado financeiro e o tempo estimado de recuperação por nível.
*Aceite:* simulação de ao menos três cenários (inadimplência isolada, inadimplência sistêmica por quebra de safra, e queda de preço com execução de garantia) com resultados coerentes e auditáveis; parecer de E4.

---

## 8. FASES, PORTÕES E CRITÉRIOS DE DECISÃO

O projeto avança por portões, e cada portão é uma opção real: paga-se o custo da fase para adquirir o direito — não a obrigação — de seguir adiante. Um portão reprovado não é fracasso; é informação adquirida a custo baixo.

### Fase 0 — Contratos e fundações (sequencial, ~1 semana)
Esquema de dados, OpenAPI, ABIs, esquemas de evento, ADRs iniciais, `CLAUDE.md` e arquivos de agente, esqueleto de infraestrutura.
**Portão G1 — Fronteira regulatória e coerência econômica.** *Veto: E1, E6. Red team ativo.* Critério: a arquitetura proposta, se implementada como especificada, não desloca a empresa para o perímetro de valor mobiliário, PSAV ou contraparte central; e cada módulo mapeia para uma redução identificável de custo de transação. **Se G1 reprovar, nenhuma linha de implementação é escrita.**

### Fase 1 — Núcleo paralelo (~3 a 4 semanas)
W1, W2, W3, W5, W7 em paralelo. W4 e W6 iniciam ao final.
**Portão G2 — Segurança, dados e privacidade.** *Veto: E2, E3, E5.* Critério: contratos sem achado crítico; varredura de PII limpa; oráculos com quórum funcionando sob falha injetada.

### Fase 2 — Integração e evidência (~3 semanas)
W4, W6, W8 e integração completa; execução do cenário de estresse.
**Portão G3 — Prontidão de demonstração.** *Veto: E1, E2, E3, E4, E5, E7. Premortem obrigatório.* Critério: a demonstração de ponta a ponta — da originação à liquidação, passando por uma divergência injetada e detectada — roda sem intervenção manual, e o painel de auditoria sustenta escrutínio.

### Fase 3 — Endurecimento e piloto assistido (~2 semanas)
Correção de achados, observabilidade produtiva, documentação, roteiro de demonstração para investidor e para regulador.
**Portão G4 — Decisão de piloto.** *Veto: E1, E4, E6, E8. Premortem e red team.* Critério: as lacunas informacionais da Seção 1.1 foram efetivamente resolvidas ou explicitamente reclassificadas como não resolvidas — e, neste caso, com recomendação de não escalar.

> **Nota sobre estimativas:** os prazos acima são referenciais e estão sujeitos à falácia do planejamento, que atinge sistematicamente projetos de software. Trate-os como hipóteses a serem calibradas após a Fase 0, não como compromissos. O portão, não a data, é o instrumento de controle.

---

## 9. CONFIGURAÇÃO DO CLAUDE CODE

### 9.1 Estrutura do repositório

```
cpr-digital/
├── CLAUDE.md                    # instruções permanentes de projeto
├── docs/
│   ├── BRIEFING.md              # este documento
│   ├── adr/                     # decisões arquiteturais
│   ├── contracts/               # OpenAPI, ABIs, esquemas (congelados na Fase 0)
│   └── panel/                   # pareceres do painel, premortems, red team
├── .claude/
│   ├── agents/                  # definições dos especialistas e construtores
│   └── commands/                # comandos reutilizáveis (portões, pareceres)
├── contracts/                   # A1
├── services/{core,oracle,eudr,compliance}/   # A2–A5
├── apps/web/                    # A6
└── infra/                       # A7
```

### 9.2 Conteúdo mínimo do `CLAUDE.md`

O `CLAUDE.md` deve conter, de forma sucinta e operacional: os sete princípios arquiteturais da Seção 2, transcritos literalmente; a regra de fronteira de diretórios entre agentes; o padrão de commit e de PR; os comandos de teste, lint e build; a exigência de ADR para toda decisão estrutural; e a proibição explícita de PII on-chain, com instrução de parar e escalar em caso de dúvida. Mantenha-o curto — instruções longas são diluídas.

### 9.3 Definição de um especialista (exemplo)

```markdown
---
name: jurista-regulatorio
description: Revisa artefatos quanto ao perímetro regulatório brasileiro
  (CVM, BCB, SUSEP). Invocar nos portões G1, G3 e G4.
tools: Read, Grep, Glob
---
Você é jurista especializado em mercado de capitais e regulação bancária
brasileira, revisando um MVP de tokenização de CPR.

Seu viés declarado: presuma que a plataforma será fiscalizada e avalie se
ela sobrevive a isso.

Verifique especificamente:
1. Nenhuma funcionalidade caracteriza oferta de valor mobiliário
   (Parecer de Orientação CVM 40/2022; Lei 6.385/76, art. 2º).
2. Nenhuma atividade caracteriza prestação de serviços de ativos virtuais
   (Lei 14.478/2022 e resoluções do BCB sobre PSAV).
3. Nenhum caminho de código realiza novação ou interposição de contraparte
   (Lei 10.214/2001).
4. O fundo mutualizado não opera como seguro (competência da SUSEP).
5. O espelhamento preserva a prevalência do registro (Lei 13.986/2020, art. 12).

Produza: veredicto (Aprovado / Aprovado com ressalvas / Reprovado), até
cinco achados por severidade, cada um com evidência (arquivo e linha) e
a norma aplicável. Não suavize. Não proponha implementação.
```

Replique a estrutura para E2 a E8, ajustando viés, mandato e checklist.

### 9.4 Comandos de portão

Crie em `.claude/commands/` um comando por portão que: (i) invoque **em paralelo** os especialistas com veto naquele portão, com contexto isolado; (ii) colete os pareceres em `docs/panel/`; (iii) consolide destacando conflitos; (iv) dispare o premortem quando aplicável; e (v) produza o dossiê do portão. A invocação paralela com isolamento é o ponto crítico — pareceres sequenciais contaminam-se mutuamente e destroem a independência que justifica o painel.

---

## 10. PROMPT DE ABERTURA (PRONTO PARA USO)

```
Leia docs/BRIEFING.md integralmente antes de qualquer ação.

Você é o orquestrador do MVP da CPR Digital. Execute a Fase 0, que é
estritamente sequencial e da qual depende todo o paralelismo posterior.

Entregáveis da Fase 0, nesta ordem:
1. Esquema de dados completo (PostgreSQL + PostGIS), com a separação
   física entre base de PII e base operacional já refletida.
2. Especificação OpenAPI de todos os serviços, com os contratos de
   fronteira entre os agentes A2 a A6 explícitos.
3. ABIs e interfaces Solidity dos contratos de W1, sem implementação.
4. Esquemas de evento e o formato do registro de auditoria.
5. ADRs para: escolha da rede distribuída; estratégia de privacidade
   on-chain/off-chain; política de quórum de oráculos; estratégia de
   upgradeability dos contratos.
6. CLAUDE.md raiz e os arquivos .claude/agents/ para os oito
   especialistas e os sete agentes construtores.

Restrições inegociáveis: os sete princípios da Seção 2 do briefing.
Em caso de conflito entre conveniência de implementação e princípio,
pare e escale — não contorne.

Ao concluir, execute o portão G1: invoque em paralelo e com contexto
isolado os especialistas E1 (jurista regulatório) e E6 (economista
institucional), mais o red team regulatório. Consolide os pareceres
destacando conflitos em vez de suavizá-los. Produza o dossiê em
docs/panel/G1/ e aguarde decisão humana antes de prosseguir.

Não escreva código de implementação nesta fase.
```

### 10.1 Prompt de disparo do paralelismo (após G1 aprovado)

```
G1 aprovado e contratos congelados em main. Inicie a Fase 1.

Crie os worktrees para os agentes A1, A2, A3, A5 e A7 e execute-os em
paralelo, cada um com o mandato e as fronteiras de diretório definidos
em seu AGENT.md. Nenhum agente edita fora de seus diretórios; mudanças
de contrato exigem solicitação formal ao orquestrador.

Sincronize diariamente por rebase contra develop. Ao final, execute o
ponto de sincronização de contratos, verificando divergência silenciosa
entre implementação e especificação, e então o portão G2.
```

---

## 11. RISCOS TÉCNICOS E MITIGAÇÕES

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Superengenharia da camada de prova de conhecimento zero | Alta | Alto | Circuito mínimo e delimitado; E3 e E6 com mandato de cortar escopo |
| Divergência silenciosa entre implementação e contrato | Alta | Médio | Ponto de sincronização por fase; testes de contrato em CI |
| Conflito de merge entre agentes paralelos | Média | Médio | Fronteiras exclusivas de diretório; rebase diário |
| Vazamento de PII para a cadeia | Média | Crítico | Teste automatizado de varredura que falha o build; veto de E2 |
| Dependência de fonte única de oráculo | Média | Alto | Quórum obrigatório por política; teste de falha injetada |
| Besu se mostrar inadequado (privacidade/desempenho) | Média | Alto | ADR com critérios de substituição definidos antecipadamente |
| Escopo expandir além das oito capacidades | Alta | Alto | Regra de ouro da Seção 1.2; rejeição por padrão |
| Estimativas otimistas (falácia do planejamento) | Alta | Médio | Controle por portão, não por data; recalibração após Fase 0 |

---

## 12. DEFINIÇÃO DE PRONTO DO MVP

O MVP está pronto quando, e somente quando, todas as condições abaixo forem simultaneamente verdadeiras.

A demonstração completa roda de ponta a ponta sem intervenção manual, cobrindo originação, espelhamento, monitoramento, uma divergência de registro injetada e detectada, um evento de inadimplência com percurso do waterfall, e a liquidação. Os oito especialistas emitiram parecer nos portões de seu mandato, sem achado crítico aberto. A varredura de PII on-chain está limpa e um pedido de eliminação de titular foi executado com evidência de irreversibilidade. O cenário de estresse — quebra de safra com queda simultânea de preço — foi executado e seu relatório está disponível. Os testes de fronteira regulatória passam, demonstrando que nenhum caminho de código executa novação, custódia de ativo virtual ou promessa de rendimento. E, por fim, o dossiê do portão G4 responde explicitamente, para cada uma das oito lacunas informacionais da Seção 1.1, se ela foi resolvida, parcialmente resolvida ou não resolvida — com a recomendação correspondente de escalar, iterar ou parar.

Esta última condição é a mais importante. Um MVP que funciona tecnicamente mas não produz evidência decisória falhou em seu propósito, ainda que todo o código esteja correto.
