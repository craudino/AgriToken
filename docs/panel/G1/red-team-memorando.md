# Memorando de acusação — Red Team regulatório

**Portão:** G1 — fronteira regulatória e coerência econômica
**Data:** 18 de setembro de 2026
**Base examinada:** branch `claude/sleepy-euler-vzyddj`, artefatos congelados da Fase 0
**Papéis assumidos:** A — fiscal hostil (CVM/BCB); B — advogado do credor que perdeu dinheiro

> Este documento não é um parecer. É uma peça de acusação. Não fui justo; a
> plataforma é que precisa ser defensável. Nada foi alterado no repositório.

---

## Nota sobre fontes

Duas consultas foram feitas nesta sessão, ambas retornando **fontes secundárias**
(escritórios de advocacia, portal de notícias da CVM). Confirmei nelas: (i) a
existência e o objeto do **Parecer de Orientação CVM 40/2022** e do **Ofício
Circular CVM/SSE 4/2023**, este último dirigido à caracterização de *Tokens de
Recebíveis / de Renda Fixa* como valores mobiliários, por possível enquadramento
no conceito de contrato de investimento coletivo do art. 2º, IX, da Lei 6.385/76;
e (ii) que a **Lei 14.478/2022** define ativo virtual no art. 3º, afasta de seu
âmbito os ativos representativos de valores mobiliários sujeitos à Lei 6.385/76, e
define no art. 5º a PSAV como quem executa, em nome de terceiros, entre outros, a
**custódia ou administração de ativos virtuais ou de instrumentos que possibilitem
controle sobre ativos virtuais**.

Não abri o texto primário de nenhuma dessas normas nesta sessão. Por rigor, toda
afirmação normativa deste memorando vai marcada com **[#REF]** — inclusive as duas
acima, cuja confirmação é de segunda mão. O painel deve conferir os dispositivos
antes de usar qualquer trecho daqui em decisão. Nenhum dos cinco ataques depende
da redação exata de uma norma: todos se sustentam em artefato do repositório.

---

## Tese central

**A plataforma construiu a sua defesa regulatória como vocabulário e a sua prova
como lint de nomes.**

A defesa do projeto é uma tríade: "espelhamos, não emitimos"; "registramos
vínculos, não custodiamos"; "conciliamos, não nos interpomos". Essa tríade é
verdadeira nos comentários e falsa nos artefatos executáveis. O que existe em
código hoje, e que um fiscal levaria para a autuação, é o seguinte:

1. um token **semi-fungível, fracionável e transferível** entre participantes que
   a própria plataforma habilita e desabilita (`IEspelhoCPR`, `IRegistroParticipantes`),
   representando direito creditório rural, apresentado a um "comprador de risco"
   com marcação a mercado, selo de conformidade e simulação de perda — o retrato
   funcional que o Ofício Circular CVM/SSE 4/2023 desenhou para tokens de
   recebíveis [#REF];
2. caso a CVM não o alcance, resta a via do BCB: se o espelho não é valor
   mobiliário, ele é representação digital de valor negociável e transferível, e a
   plataforma detém **instrumentos que possibilitam controle sobre ele** — congelar,
   pausar, desabilitar o titular —, o que é a hipótese literal do art. 5º da Lei
   14.478/2022 [#REF];
3. e a única barreira que o repositório opõe às duas hipóteses é um **array de
   expressões regulares sobre nomes de função em seis arquivos `.sol`**
   (`infra/ci/validar-abis.mjs:49-55`).

Essa é a pinça. O projeto não precisa escolher entre os dois perímetros: **quem
escolhe é o fiscal**, e o repositório não oferece, hoje, um único teste que
produza evidência contrária em qualquer das duas frentes. Pior: o P7 — o princípio
que o briefing declara "codificado" — é o único dos sete princípios que **não é
verificado no banco, nem na API, nem nos eventos**; e o P1 — o alicerce jurídico do
espelhamento — é destrancável por uma string literal.

---

## Ataque 1 — O teste de fronteira regulatória (P7) não testa a proibição: testa a grafia
**Papel A — fiscal hostil. Letalidade: máxima.**

**Evidência.**
- `infra/ci/validar-abis.mjs:13` — `FONTES = contracts/interfaces`. O universo do
  teste são os **seis arquivos de interface**. Implementação, serviços, API, banco
  e eventos ficam fora do alcance, por construção.
- `infra/ci/validar-abis.mjs:49-55` — o teste de P7 é uma lista de regex sobre
  **nomes de função**: `^deposit`, `^custodiar`, `^novar`, `^assumirContraparte`,
  `^garantirRetorno`, `^yield`…
- `infra/ci/validar-abis.mjs:62-83` — a verificação percorre `item.name` da ABI.
  Nada examina comportamento, fluxo de valor, parte contratante ou payload.
- `infra/ci/validar-abis.mjs:88-93` — a proibição de função `payable` é aplicada
  **exclusivamente a `ICofreGarantias`**.
- `docs/contracts/abi/IEspelhoCPR.json:467, 762, 785` — a ABI congelada do
  **espelho** declara três funções `payable` (`approve` e as duas sobrecargas de
  `transferFrom`), herdadas de `contracts/interfaces/IERC3525.sol:37,41,43`.
- `infra/ci/validar-openapi.mjs`, `infra/ci/validar-eventos.mjs`,
  `docs/contracts/db/testes/*.sql` — **nenhuma ocorrência de P7**. O próprio
  `infra/README.md:12` descreve o portão de esquema como "P1 a P6".
- Contra isso: `CLAUDE.md:35-38` ("Estas proibições existem como testes
  automatizados que falham se a fronteira for cruzada"), `README.md:38-41`
  ("recusam função de custódia ou novação nos contratos") e `infra/README.md:10`
  ("testa a fronteira regulatória (P7)").

**O que eu alegaria.** Que a empresa declarou, por escrito e em três documentos
distintos, possuir controle automatizado de fronteira regulatória, e que esse
controle, examinado, é um verificador ortográfico. Duas das quatro proibições do
P7 — *não se interpor como contraparte* e *não prometer rendimento* — não possuem
teste algum: possuem apenas os nomes `assumirContraparte` e `garantirRetorno` na
lista de proibidos, isto é, nomes que ninguém escreveria. A função que crie a
interposição se chamará `registrarCessao`, e passará. Acrescento que a proibição
de receber valor foi aplicada ao cofre e **esquecida no espelho**, que é o
contrato que efetivamente circula: a ABI congelada do `IEspelhoCPR` admite valor
nativo em transferência e aprovação, e o CI a aprova. Ou seja, o único ponto em
que a fronteira foi de fato codificada como propriedade — e não como nome — é
exatamente o ponto em que o teste não olha. Sustentarei, por fim, que o argumento
"é Fase 0, não há implementação" agrava em vez de socorrer: o briefing (Seção 8)
condiciona a escrita de qualquer linha à aprovação deste portão, de modo que o
que se aprova aqui é precisamente **este** desenho de controle.

---

## Ataque 2 — O congelamento por divergência é destrancado por uma string literal
**Papel B — advogado do credor (com reforço do Papel A). Letalidade: altíssima.**

**Evidência.**
- `docs/contracts/db/ops/040_contrato_espelhado.sql:162-177` — `fn_bloqueia_congelado`:
  `IF v_situacao = 'CONGELADO' AND NEW.guarda <> 'divergencia_reconciliada' THEN RAISE`.
  A única condição para transitar um contrato congelado é que a coluna `guarda`
  contenha aquela string.
- `docs/contracts/db/ops/040_contrato_espelhado.sql:128` — `guarda text NOT NULL`,
  preenchida pelo chamador; `:139-156` — `fn_valida_transicao` valida o par
  (`de`,`para`) contra `ops.transicao_permitida` e **não confere a guarda**. O
  valor declarado na tabela de transições permitidas (`:107-123`) é decorativo.
- Não há chave estrangeira, gatilho ou *check* ligando a transição a uma linha
  reconciliada de `ops.divergencia`, nem à mudança de `situacao_conciliacao`, nem
  ao `reconciliada_por`.
- `docs/contracts/db/testes/conformidade_ops.sql:69-73` — o teste que se anuncia
  como prova de P1 tenta a transição com a guarda
  `'pagamento_conciliado_e_baixa_no_registro'` e comemora a recusa. **A string que
  destranca nunca é tentada.**
- `docs/contracts/db/ops/040_contrato_espelhado.sql:130` — `ator_ref` é **anulável**:
  a transição pode não registrar quem a acionou, contra o P5 ("timestamp, origem,
  autor e evidência").

**O que eu alegaria.** Sob o Papel B: que o congelamento vendido ao meu cliente
como salvaguarda — o mecanismo que impediria que seu crédito continuasse a andar
enquanto o registro e o token divergiam — é destrancado por qualquer processo
capaz de gravar sete palavras numa coluna de texto, sem reconciliação humana,
sem autor obrigatório e sem vínculo com a divergência que motivou o
congelamento. Um contrato com divergência CRÍTICA aberta pode ser gravado como
`LIQUIDADO` por essa via. Sob o Papel A: que o P1 — "o registro prevalece", pedra
angular de toda a arquitetura jurídica de espelhamento e da defesa de que a
plataforma não emite título próprio — está implementado como comparação de
string, e que o teste de conformidade foi escrito para exercitar apenas o ramo
que funciona. Este é o achado que mais me serve, porque não exige interpretação
de norma: exige leitura de duas linhas de SQL e de um teste que não as cobre.

---

## Ataque 3 — Quem pode imobilizar exerce controle; quem exerce controle está no perímetro
**Papel A, com desdobramento no Papel B. Letalidade: alta — e estrutural.**

**Evidência.**
- `contracts/interfaces/IEspelhoCPR.sol:80-87` — `congelar` / `descongelar`:
  "enquanto congelado, toda transferência de valor reverte".
- `contracts/interfaces/IControleAcesso.sol:36-37` — `PAPEL_PAUSA`, pausa
  emergencial da plataforma.
- `contracts/interfaces/IRegistroParticipantes.sol:20-22` — `habilitar` /
  `desabilitar`: a plataforma decide quem pode deter ou receber o espelho; o
  espelho reverte para titular não habilitado (`IEspelhoCPR.sol:52`,
  `TitularNaoHabilitado`).
- `contracts/interfaces/IControleAcesso.sol:8-10, 29-31` — a NatSpec afirma
  multiassinatura e timelock. A interface, porém, expõe `conceder(bytes32,address)`
  e `revogar(bytes32,address)` como **chamadas únicas e imediatas** (`:44-46`);
  existe o evento `PapelPropostoComTimelock` (`:14`) e o *getter* `atrasoTimelock()`
  (`:49`), mas **não existe função de proposta**. O timelock é um evento sem
  emissor e um número sem processo.
- `docs/contracts/db/ops/080_conciliacao.sql:91-103` — `politica_divergencia` fixa
  `sla_deteccao` (15 minutos a 6 horas). **Não há prazo de resolução**: nada na
  Fase 0 limita quanto tempo um contrato permanece congelado.

**O que eu alegaria.** Sob o Papel A: que a plataforma detém, cumulativamente,
três poderes unilaterais sobre ativo de terceiro — imobilizar o token
(`congelar`), imobilizar a rede inteira (`PAPEL_PAUSA`) e inabilitar o titular
(`desabilitar`) — e que quem detém a faculdade de impedir a disposição de um ativo
alheio administra **instrumento que possibilita controle** sobre ele, na dicção do
art. 5º da Lei 14.478/2022 [#REF], ainda que jamais toque em chave privada. O
contra-argumento previsível ("a rede é permissionada e o congelamento decorre do
P1") é justamente o que fecha a pinça: **é o cumprimento do P1 que produz o
controle que o P7 nega**. Não há redação de código que resolva a contradição; há
escolha a fazer, e a Fase 0 não a fez. Sob o Papel B, acrescento o dano concreto:
meu cliente, credor de boa-fé, teve seu ativo imobilizado por ato unilateral da
plataforma, sem prazo máximo, sem recurso previsto em contrato e sem que o
mecanismo de multiassinatura anunciado na documentação exista como caminho de
código — a concessão do papel que descongela é, na interface congelada, uma
chamada única de administrador.

---

## Ataque 4 — P4 é descrito como quórum de duas fontes e implementado como "pelo menos uma"
**Papel B — advogado do credor. Letalidade: alta.**

**Evidência.**
- `CLAUDE.md:22-24` / Briefing P4 — "toda leitura crítica exige quórum mínimo de
  duas fontes".
- `docs/contracts/db/ops/060_oraculos.sql:66-68` — `CONSTRAINT efetiva_tem_quorum
  CHECK (estado NOT IN ('EFETIVA','DEGRADADA') OR fontes_independentes >= 1)`. O
  invariante gravado no banco é **uma** fonte independente, não duas.
- `docs/contracts/db/ops/060_oraculos.sql:117-135` — `fn_valida_uso_leitura`, o
  guardião do consumo contratual, verifica apenas (i) que a criticidade não é
  `INFORMATIVA` e (ii) que o estado é `EFETIVA` **ou `DEGRADADA`**. Não confere
  `fontes_independentes`, nem `min_fontes`, nem `dispersao_pct`.
- `docs/contracts/db/ops/060_oraculos.sql:38-46` — `PRECO` é `CONTRATUAL` e
  `permite_degradado = true`. É a leitura que alimenta marcação a mercado e
  gatilho de inadimplência.
- `docs/contracts/db/testes/conformidade_ops.sql:86-99` e `:101-109` — o teste de
  P4 cobre dois ramos: leitura `SEM_QUORUM` e leitura `INFORMATIVA`. **O ramo
  `DEGRADADA` com uma única fonte independente — o que passa — não é testado.**
- `docs/contracts/db/ops/060_oraculos.sql:22-36` — `criticidade` é coluna mutável
  de `politica_quorum`; o *check* só amarra `CONTRATUAL` a duas fontes. Reclassificar
  `PRECO` para `INFORMATIVA` e reduzir `min_fontes` a 1 é um `UPDATE` que passa no
  *check*, e `docs/contracts/openapi/oracle.yaml:126-145` expõe `PUT /politicas`
  para isso — sem chave de idempotência e fora da lista de operações irreversíveis
  de `infra/ci/validar-openapi.mjs:36-40`.
- `docs/contracts/openapi/oracle.yaml:80-99` — `abrirDisputa` "suspende o efeito
  contratual da leitura imediatamente", exigindo `fundamento` com **20 caracteres**.
  A especificação não diz quem pode abrir.

**O que eu alegaria.** Que o documento vendeu redundância e o esquema entregou
tolerância a fonte única. Na safra ruim com preço em queda — o cenário que o
próprio briefing elege como o mais estressante —, a marcação a mercado do
colateral do meu cliente e o gatilho de inadimplência do seu devedor podem ser
apurados sobre uma leitura `DEGRADADA` construída com **uma** fonte, e o banco
aprovará a operação. E que, no dia em que a leitura for desfavorável a quem opera
a plataforma, bastam vinte caracteres de "fundamento" para suspender o efeito
contratual do número. O conjunto de testes não refuta nada disso: ele exercita os
dois ramos que bloqueiam e ignora o terceiro, que libera. Isto é desenho de teste
para confirmar, não para falsear.

---

## Ataque 5 — O sistema tem canal para a boa notícia e não tem para a má
**Papel B — advogado do credor. Letalidade: média-alta, e alta em dano reputacional.**

**Evidência.**
- `docs/contracts/openapi/core.yaml:336` — `selo_eudr` figura em `ContratoResumo`,
  o objeto que alimenta a listagem do painel do comprador de risco. O resumo
  **não** carrega a data do selo, a evidência que o sustenta nem a sua validade.
- `docs/contracts/db/ops/070_eudr.sql:33` — `valida_ate` na evidência ("força
  reavaliação contínua"); `:58-67` — `ops.reavaliacao_eudr` com `mudou_resultado`;
  `:53` — `ops.dds.revogada_em`. O modelo reconhece que o selo é **atributo
  perecível do colateral**.
- `docs/contracts/events/catalogo.json:16-17` — o catálogo de eventos prevê
  `eudr.evidencia-gerada` e `eudr.dds-emitida`. **Não existe** evento de selo
  revogado, de reavaliação que mudou o resultado, de DDS revogada, de participante
  desabilitado ou de garantia liberada. Nenhum invariante liga
  `ops.contrato.selo_eudr` (`040:46-48`) à validade da evidência subjacente.
- `docs/contracts/events/catalogo.json:8` — `contrato.transicionado` tem
  `exige_evidencia: false`. A transição para `INADIMPLENTE` — a que mais
  interessa ao meu cliente — é justamente a que não exige evidência, enquanto
  `contrato.espelhado` (`:7`) exige.
- `docs/contracts/openapi/core.yaml:208-219` — a reconciliação admite a decisão
  `MARCAR_FALSO_POSITIVO`, com `justificativa` de 20 caracteres e um campo
  `operador` que é **string autodeclarada**; o `403` promete recusar "processo
  automático" sem que exista mecanismo que o distinga.
- `docs/contracts/db/ops/080_conciliacao.sql:68-72` — `reconciliada_por text`, com
  *check* que exige apenas **não-nulo**; `:79-80` — o comentário afirma "sempre
  humano identificado", e comentário não é restrição.

**O que eu alegaria.** Que a plataforma se apresentou como garantidora de
atributos do colateral — o selo EUDR estampado na listagem, a marcação a mercado,
o estado de conciliação — e organizou o sistema para **publicar a aquisição desses
atributos e silenciar sobre a sua perda**. O selo é, por desenho e por confissão
do próprio comentário do DDL, perecível; não há evento que comunique a queda, não
há vínculo entre o selo exibido e a validade da evidência, e o painel que meu
cliente consultou antes de comprar mostra o rótulo sem a data. Acrescento o
conflito de interesse: o mesmo operador que detecta a divergência pode carimbá-la
de falso positivo, identificando-se por uma string que ele mesmo digita e
justificando-se em vinte caracteres — o sistema não distingue um humano de um
*script*, embora o documento afirme que distingue. Há, aqui, promessa implícita
de qualidade de informação acompanhada de arquitetura desenhada para a assimetria.

---

## Ataque mais difícil de rebater

O **Ataque 3**.

Os ataques 1, 2, 4 e 5 são letais, mas curáveis: ampliar o alcance do teste de
P7, trocar a string mágica por uma chave estrangeira contra a divergência
reconciliada, exigir `fontes_independentes >= min_fontes` no gatilho de uso e
acrescentar ao catálogo os eventos de má notícia são correções de dias, não de
arquitetura. Se o painel as fizer, perco quatro quintos deste memorando.

O Ataque 3 não se corrige escrevendo código, porque é uma **contradição entre dois
princípios do próprio briefing**. Para que o P1 seja verdadeiro — o registro
prevalece, e a divergência congela as operações sobre aquele contrato — a
plataforma precisa deter o poder de impedir unilateralmente a disposição de um
ativo de terceiro. Para que o P7 seja verdadeiro — não custodiar, não administrar
instrumento de controle sobre ativo alheio — ela precisa não deter esse poder.
Quanto mais convincente for a demonstração de que o congelamento funciona (e é
essa demonstração que o briefing elege como o teste de aceitação mais importante
do MVP), mais forte fica a peça de acusação sobre controle funcional. Qualquer
resposta que eu receba a este ponto será uma escolha entre enfraquecer a
salvaguarda que sustenta a tese de espelhamento e admitir o poder que aproxima do
perímetro.

Não afirmo que a pinça seja intransponível. Afirmo que a Fase 0 não a enfrentou,
que não existe ADR em `docs/adr/` sobre ela — os quatro existentes tratam de rede,
privacidade, quórum e *upgradeability* — e que aprová-la em silêncio é escolher
sem registrar, contra o próprio protocolo do painel.

---

*Red team regulatório — adversário declarado. Este memorando integra o dossiê de
G1 e não constitui parecer de especialista com veto.*
