# Dossiê do portão G1 — fronteira regulatória e coerência econômica

**Data:** 2026-09-18 · **Fase avaliada:** Fase 0 (contratos e fundações)
**Protocolo:** Briefing, Seção 3.2 · **Consolidação:** orquestrador
**Decisão:** pendente — aguardando humano

Os três pareceres foram produzidos **em paralelo, com contexto isolado**.
Nenhum revisor leu o parecer do outro, e nenhum recebeu resumo do orquestrador:
cada um leu os artefatos por conta própria. Os textos estão íntegros em
`e1-parecer.md`, `e6-parecer.md` e `red-team-memorando.md`, sem edição — inclusive
onde contrariam o orquestrador.

---

## 1. Veredictos, lado a lado

| Revisor | Veredicto | Achado de maior severidade |
|---|---|---|
| **E1 — jurista regulatório** (veto em G1) | **REPROVADO** | Fração do espelho circula entre terceiros sem cessão registrada, e o catálogo de divergências é cego ao sentido token→registro |
| **E6 — economista institucional** (veto em G1) | **APROVADO COM RESSALVAS** | Nenhum artefato da Fase 0 instrumenta custo, e seis das oito lacunas são de custo ou disposição a pagar |
| **Red team regulatório** (sem veto; adversário) | *Não emite veredicto* | A defesa regulatória foi construída como vocabulário e a prova como lint de nomes |

**Um dos dois revisores com veto reprovou.** Pelo critério do briefing (Seção 8),
isso basta para que nenhuma linha de implementação seja escrita até decisão
humana. Nada foi corrigido desde os pareceres: corrigir antes da decisão seria
atravessar o portão por conta própria.

---

## 2. Verificação independente do orquestrador

Achados técnicos foram reproduzidos contra o esquema vivo antes de entrarem
aqui. Não é desconfiança dos revisores: é o que distingue achado de alegação.

| Achado | Origem | Reprodução | Resultado |
|---|---|---|---|
| Congelamento destrancável por string literal | Red team #2 | `INSERT` em contrato `CONGELADO` com `guarda = 'divergencia_reconciliada'`, sem divergência reconciliada, sem operador humano, `ator_ref` nulo | **Aceito pela base.** Transição ATIVO→LIQUIDADO consumada |
| Leitura contratual efetiva com uma fonte independente | E6 A3 / Red team #4 | Leitura `PRECO` `DEGRADADA` com `fontes_independentes = 1` consumida em `ops.uso_leitura` | **Aceito pela base.** Caminho aberto até `LTV_ROMPIDO` |
| Espelho declara funções `payable` | Red team #1 | Leitura da ABI congelada | **Confirmado:** `approve` e `transferFrom` (duas sobrecargas) |
| Timelock existe como evento e getter, sem função de proposta | Red team #3 | Funções mutantes de `IControleAcesso` | **Confirmado:** apenas `conceder` e `revogar`, imediatas |
| Nenhum ADR sobre perímetro regulatório | E1 A3 | Busca por CVM, 6.385, 14.478, 10.214, PSAV, SUSEP em `docs/adr/` | **Confirmado:** zero ocorrências |
| Teste de P7 alcança só `contracts/interfaces/` | E1 A4 / Red team #1 | Leitura de `validar-abis.mjs` e do workflow de CI | **Confirmado:** `services/` fora do alcance |
| Sem evento de selo revogado, DDS revogada ou participante desabilitado | Red team #5 | Busca no catálogo de eventos | **Confirmado:** único evento de má notícia é `oraculo.quorum-perdido` |
| Garantia real sem campo de averbação ou oponibilidade | E1 A5 | Colunas de `ops.garantia` | **Confirmado** |

Os dois primeiros são os mais graves, porque não são omissões de escopo: são
**falhas de artefato congelado que os próprios testes de conformidade deixaram
passar**. No caso do congelamento, o teste que se anuncia como prova de P1 usa
outra guarda e comemora a recusa — a string que destranca nunca é tentada. Isso
é pior que ausência de teste: é falsa garantia, e foi escrita pelo orquestrador.

---

## 3. Convergência entre revisores isolados

Três revisores sem contato entre si atingiram os mesmos dois pontos. Em
processo com contexto isolado, convergência é sinal forte — não houve como um
contaminar o outro.

**Convergência 1 — P7 é o princípio mais fraco do repositório.** E1 (A4) e o
red team (#1) chegam à mesma conclusão por caminhos distintos: a proibição de
novação, custódia e promessa de rendimento existe como lista de nomes de função
sobre seis interfaces, e não alcança os serviços, onde a conduta de fato
ocorreria. A assimetria que E1 formula é exata: P2 ganhou `CHECK` de domínio no
banco; P7 ganhou uma lista de palavras.

**Convergência 2 — P4 vaza pelo ramo degradado.** E6 (A3) e o red team (#4)
identificam o mesmo caminho, reproduzido acima. O ADR-0003 afirma em negrito
que não existe caminho de decisão contratual com fonte única. A afirmação é
falsa quanto ao ramo `DEGRADADA`.

**Convergência 3 — falta ADR sobre a premissa central.** E1 aponta a ausência
de ADR de perímetro regulatório; E6 aponta a ausência de ADR sobre as premissas
embutidas na interface da registradora simulada; o red team aponta a ausência de
ADR sobre a tensão P1×P7. São três lacunas distintas com a mesma causa: o
orquestrador escreveu os quatro ADRs pedidos no prompt e não escreveu os que a
própria regra do `CLAUDE.md` exigia.

---

## 4. Conflitos entre pareceres

Apresentados sem síntese conciliatória, conforme o passo 2 do protocolo.

### Conflito 1 — a Fase 0 é reprovável ou aprovável com ressalvas?

**E1:** reprovado. A tese do projeto é defensável, a especificação congelada não
é. A circulação de frações fora do registro, somada a MTM publicada pela
plataforma, fundo mutualizado absorvendo perda e ausência de qualificação do
comprador de risco, compõe o conjunto de fatos do art. 2º, IX, da Lei 6.385/76.
Congelar artefato com esse defeito é congelar o problema.

**E6:** aprovado com ressalvas. A Fase 0 conteve o risco de superengenharia (zk
ausente por omissão deliberada), o ADR-0003 distingue eliminar de transferir
custo de mensuração, e o ADR-0001 mantém aberta a opção real do plano B. O
defeito é de instrumentação — o MVP não mede o que promete medir —, corrigível
sem refazer os contratos.

**Onde exatamente discordam:** não nos fatos, e sim no que um portão significa.
E1 trata G1 como certificação de que o artefato congelado é defensável; E6 trata
G1 como decisão de prosseguir sob condições registradas. O briefing sustenta as
duas leituras — Seção 8 diz "se G1 reprovar, nenhuma linha é escrita", e também
que um portão é opção real, não obrigação. **Esta é a divergência que vai para a
decisão humana, e o orquestrador não a resolve.**

### Conflito 2 — o que fazer com DID/VC

**E6 (A5):** componente sem lacuna. As rotas de credencial verificável não
mapeiam para nenhuma das oito capacidades, e estar na Seção 5 do briefing não as
salva: a regra de ouro da Seção 1.2 vale contra o briefing tanto quanto contra
um agente. Recomendação implícita: cortar.

**E1 (implícito em A1):** a ausência de qualificação do comprador de risco é
parte do conjunto de fatos que aproxima o espelho de valor mobiliário. A
credencial verificável é justamente o mecanismo que atestaria essa qualificação.

**Onde exatamente discordam:** E6 vê custo sem lacuna; E1 vê, no mesmo lugar, a
peça que falta para a defesa regulatória. Cortar DID/VC atende E6 e agrava A1 de
E1. **Decisão humana.**

### Conflito 3 — a tensão P1 × P7 é defeito ou é o produto?

**Red team (#3, o que ele próprio julga mais difícil de rebater):** para P1 ser
verdadeiro, a plataforma precisa poder impedir unilateralmente a disposição de
ativo de terceiro; para P7 ser verdadeiro, precisa não poder. Quanto melhor a
demonstração de que o congelamento funciona — o teste que o briefing elege como
o mais importante do MVP —, mais forte a acusação de controle funcional.

**E6:** trata o congelamento como o mecanismo de enforcement que justifica
economicamente a plataforma; sua ressalva A2 é que ele pode não disparar a
tempo, não que ele não deva existir.

**Onde exatamente discordam:** o red team vê no congelamento um passivo
regulatório proporcional à sua eficácia; E6 vê nele o ativo central. Ambos podem
estar certos ao mesmo tempo, e é exatamente por isso que exige decisão
registrada. **Decisão humana, com ADR obrigatório qualquer que seja o rumo.**

---

## 5. As oito capacidades

O inventário está em `evidencia-fase-0.md`. O que os pareceres acrescentam:

| # | Capacidade | Contrato congelado | O que o painel observou |
|---|---|---|---|
| F1 | Onboarding e KYC/KYB | Sim | E6 A1: `ops.produtor` não guarda nada que permita computar o custo de verificação, que **é** a lacuna |
| F2 | Originação e espelhamento | Sim | E1 A1: a interface permite circulação de fração fora do registro |
| F3 | Conciliação contínua | Sim | Única lacuna com placar (`vw_placar_conciliacao`); E6 A2: medida contra simulador de premissas não declaradas |
| F4 | Motor EUDR | Sim | E6 A1 e A4: guarda resultado e hash, não o custo; e nada verifica que o polígono é do produtor |
| F5 | Marcação a mercado | Sim | E6 A3 e red team #4: caminho aberto para MTM com fonte única degradada |
| F6 | Garantias e waterfall | Sim | E1 A5: oponibilidade não é representável; E1 A2: duas espécies congeladas sem especificação |
| F7 | Painel do comprador de risco | Sim | E6 A5: a lacuna é disposição a pagar, e nada registra reação revelada de credor |
| F8 | Liquidação e baixa | Sim | Red team #5: sem canal de evento para a má notícia |

---

## 6. Regra antiviés

Nenhum dos três revisores invocou precedente do tipo "no projeto X isso
funcionou". A pergunta de controle de contexto não precisou ser aplicada.

Registre-se o oposto, que é o achado de processo deste portão: **os três
revisores encontraram defeitos que os testes automatizados do orquestrador
declaravam cobertos.** O viés não apareceu nos pareceres; apareceu nos testes de
quem construiu.

---

## 7. Recomendação do orquestrador

*Esta seção é do orquestrador, não do painel. Está separada de propósito.*

**Recomendo REPROVAR G1 e devolver à Fase 0 com lista fechada de correções,
seguida de nova rodada de G1.**

Três razões, em ordem de peso:

1. **Dois defeitos reproduzidos em artefato congelado**, não hipóteses: o
   congelamento destrancável por string e a leitura contratual de fonte única
   por via degradada. Ambos atingem princípios que o projeto declara
   inegociáveis, e ambos passaram pelos testes que eu escrevi.
2. **Três ADRs ausentes por regra própria do projeto.** Perímetro regulatório,
   premissas da registradora e tensão P1×P7. O `CLAUDE.md` diz que não há
   decisão não registrada; aprovar em silêncio seria decidir sem registrar.
3. **O custo de corrigir é de dias, e o de não corrigir é de semanas.** Os
   defeitos estão em contratos congelados: se a Fase 1 começar sobre eles, cada
   correção passa a exigir mudança de contrato em sete frentes paralelas — o
   retrabalho em cascata que a Fase 0 existe para evitar.

O que **não** recomendo: reabrir o escopo. As oito capacidades seguem íntegras,
e nenhum revisor pediu funcionalidade nova. A ressalva A1 de E6 — instrumentar
custo — é a única que acrescenta artefato, e é acrescentar campo e placar, não
capacidade.

Sobre o Conflito 1, minha posição não substitui a divergência: E6 pode estar
certo de que isto é decisão de prosseguir sob condições. Se a sua decisão for
essa, o que peço é que as condições virem ADR antes da primeira linha de
implementação, e não depois.

---

## 8. Decisão humana

- [ ] **Aprovado** — inicia a Fase 1 (prompt da Seção 10.1 do briefing)
- [ ] **Aprovado com ressalvas** — registrar aqui as condições e os ADRs exigidos antes da Fase 1
- [ ] **Reprovado** — devolve à Fase 0 com lista de correções e nova rodada de G1

Decisor: ____________________ Data: ____________

Observações:
