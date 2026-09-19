# Dossiê do Portão G2 — Segurança, dados e privacidade

**Data:** 2026-09-19 · **HEAD avaliado:** `162f48e` (E5 concluiu sobre `8209ff8`)
**Critério do portão:** contratos sem achado crítico; varredura de PII limpa;
oráculos com quórum funcionando sob falha injetada.

---

## Veredicto

| Especialista | Domínio | Veredicto |
|---|---|---|
| E2 | Privacidade e proteção de dados | **REPROVA** |
| E3 | Segurança de contratos e invariantes | **REPROVA** |
| E5 | Geoespacial, oráculos e linhagem | **REPROVA** |

**Três de três reprovam. O portão está reprovado.**

O critério é objetivo e falha em dois dos três itens:

| Critério | Resultado |
|---|---|
| Contratos sem achado crítico | **FALHA** — dois críticos, provados por execução (E3 C1, C2) |
| Varredura de PII limpa | Passa como executada — **mas E2 A1 mostra que o guarda não alcança eventos, `bytes` nem `contracts/src/`** |
| Quórum sob falha injetada | **FALHA** — 24/24 no aceite, e E5 C4 prova que o mecanismo de independência é dependente de ordem |

---

## Os onze achados críticos

Todos confirmados pelo orquestrador de forma independente antes de entrarem aqui.
A coluna "conferido" diz **como**, não se.

| # | Achado | Fonte | Conferido |
|---|---|---|---|
| **K1** | `inicializar()` sem controle de acesso → sequestro do espelho | E3 C1 | leitura: guarda é só `_inicializado` |
| **K2** | `executar()` sai do congelamento com a mesma chave que congela | E3 C2 | leitura: ambos exigem `PAPEL_CONCILIADOR`; NatSpec 3 linhas acima promete o contrário |
| **K3** | Reidentificação sobrevive à eliminação (`documento_hmac`, chave única) | E2 C1 | **execução**: onboarding → eliminação → titular localizado só pelo CPF |
| **K4** | Polígono bruto fora do crypto-shredding | E2 C2 | leitura: eliminação toca 4 tabelas, nenhuma é `geo.talhao_geometria` |
| **K5** | Trilha de auditoria bifurca sob concorrência | orquestrador | **execução**: 10 inserções concorrentes; alarme disparou com 12 inconsistentes |
| **K6** | `contarIndependentes` depende da ordem das linhas | E5 C4 | **execução**: `CEPEA,X,Y => 1` mas `X,Y,CEPEA => 2` |
| **K7** | Sobreposição zero vira `CONFORME` sem passar pela margem | E5 C1 | leitura: `area === 0 ? 'CONFORME'` e o CHECK que a codifica |
| **K8** | Bump de versão de base transforma `NAO_CONFORME` em `CONFORME` | E5 C2 | execução do especialista em `BEGIN/ROLLBACK` |
| **K9** | Três produtores com o mesmo polígono, hash idêntico | E5 C3 | **execução**: 3 talhões, 3 produtores, um hash |
| **K10** | Quórum geoespacial é a mesma computação circulando por si mesma | E5 C5 | leitura do caminho `avaliar → /leituras/fonte → lerGeo` |
| **K11** | `Idempotency-Key` declarado e implementado em lugar nenhum | orquestrador | **execução**: zero ocorrências nos 5 controladores |

---

## CONFLITOS ENTRE PARECERES

O portão exige que conflitos sejam destacados em vez de suavizados. Há **três**,
e nenhum deles é desacordo sobre fatos — são desacordos sobre severidade e sobre
o que conta como verificado.

### Conflito 1 — A fronteira on-chain: E2 aprova, E3 reprova o mesmo objeto

**E2** escreve, na seção do que está bem feito: *"A fronteira on-chain é real.
`grep -n "string" contracts/src/*.sol` retorna uma única ocorrência, e é num
comentário. P2 está de fato respeitado nos contratos que existem hoje; o defeito
de A1 é do guarda, não do que ele guarda."*

**E3** reprova os mesmos contratos com dois críticos e prova por mutação que uma
função `payable` de rendimento atravessa `validar:contratos`, `validar:p7` e os
61 testes.

**Não é contradição, e a distinção importa.** E2 avaliou *o que os contratos
contêm* quanto a PII e concluiu, corretamente, que não contêm. E3 avaliou *o que
os contratos permitem* quanto a controle de acesso e fronteira regulatória, e
concluiu que permitem demais. Os dois estão certos sobre coisas diferentes.

O ponto de tensão real: **E2 usou a limpeza atual dos contratos como atenuante**
(*"o defeito é do guarda, não do que ele guarda"*), e E3 demonstrou que sem o
guarda a limpeza atual não é garantia de nada — ela é um fato sobre hoje, não uma
propriedade do sistema. Para a decisão do portão, prevalece a leitura de E3: uma
propriedade que depende de ninguém ter escrito a linha errada ainda não é
propriedade.

### Conflito 2 — A ofuscação de centroide: mesmo achado, severidades diferentes

**E2** classifica como **ALTA** (§A3). **E5** classifica como **ALTA** (§A2) mas
acrescenta medição própria: as seis distâncias reais medidas são
`4983,22 / 4988,69 / 4999,07 / 4998,21 / 4985,19 / 4994,03` metros — banda de
±17 m sobre uma circunferência, área efetiva de busca ≈ 1,07 km² contra os
78,5 km² que o nome sugere. Redução de ~73×.

O conflito está no enquadramento: E2 trata como falha de privacidade; E5 trata
também como falha de qualidade de dado geoespacial. **E5 mediu, E2 deduziu.** A
medição de E5 é mais forte e sustenta severidade maior do que qualquer um dos
dois atribuiu — dado que, somado a `municipio_ibge` e `area_calculada_ha` com
precisão de 1 m², a reidentificação é descrita por E5 como "trivial".

Registro a divergência sem resolvê-la: elevar a severidade é decisão do painel
humano, não do orquestrador.

### Conflito 3 — A evidência de E5 para K7 não é reproduzível a partir do repositório

Este é o conflito mais desconfortável, e **foi o próprio E5 que o levantou**, na
seção do que não conseguiu verificar:

> *"Os talhões `QUASE-ENCOSTA-5m`, `SOBREP-40pct-5ha` e `LIMITROFE-massa`
> existem na base viva mas não estão em nenhum arquivo do repositório (`grep` em
> toda a árvore: zero ocorrências). São estado de banco sem script de origem
> versionado — não reprodutíveis a partir do repositório, e portanto não são
> evidência de portão."*

O achado K7 (sobreposição zero vira `CONFORME`) é apresentado com uma tabela
medida sobre `QUASE-ENCOSTA-5m`. Se esse talhão não vem do repositório, a
demonstração empírica repousa sobre uma fixture de origem desconhecida.

**Verificação do orquestrador:** a parte do achado que **não** depende da fixture
é airtight e foi conferida diretamente no código —
`services/eudr/src/eudr.service.ts:81` e `:181` contêm
`area === 0 ? 'CONFORME' : ...`, e
`docs/contracts/db/ops/070_eudr.sql:56` contém
`CHECK (resultado <> 'CONFORME' OR area_sobreposta_ha = 0)`. A lógica está lá,
independentemente de qualquer linha de banco.

**Conclusão:** K7 permanece como achado crítico pelo argumento de código. A
tabela empírica fica registrada com a ressalva de proveniência que o próprio
especialista fez. Um especialista que declara a fragilidade da própria evidência
está fazendo o trabalho certo, e a ressalva não é atenuante do achado — é
delimitação do que ele prova.

---

## O padrão que atravessa o portão

Em G1 o padrão foi: **a garantia morava no comentário, não no código.**

Em G2 o padrão é um nível acima: **o que reprova não é o código, é o que verifica
o código.** Sete instâncias, todas verificadas:

| Verificador | O que ele confere | O que ele não alcança |
|---|---|---|
| `validar:contratos` | interfaces contra interfaces | `contracts/src/`, eventos, `bytes` (E2 A1, E3 M5) |
| `validar:openapi` | a especificação contra si mesma | 32 rotas implementadas e não declaradas (K11, G2-O-03) |
| Invariante I2 | soma de saldos que o teste rastreia | `valorCirculanteDoSlot`, que é a propriedade publicada (E3) |
| Invariante I3 | dois caminhos de fracionamento | o caminho token→token com origem congelada (E3) |
| Invariante I6 | `approve`, um caso | a propriedade "toda função payable recusa valor" (E3) |
| Teste "nenhum contrato aceita ether" | o mesmo contrato, cinco vezes | os outros quatro contratos (E3 B1) |
| `cobertura.test.cjs:118-129` | — | **codifica o defeito K2 como comportamento esperado** |

A última linha é a mais grave do dossiê. Não é um teste que falha em pegar um
bug: é um teste que **documenta o bug como requisito**. Quem corrigir K2 vai
quebrar esse teste e ser levado a pensar que introduziu uma regressão.

### Cobertura de 100% medindo a coisa errada

`docs/panel/G2/evidencia/cobertura-contratos.txt` reporta 100% de statements,
funções e linhas, e 90% de ramos. Os números estão corretos. E3 mutou o código em
três pontos e os 61 testes passaram nos três. A meta I10 (cobertura ≥ 90%) foi
atingida; as metas I2, I3 e I6, que o `docs/contracts/abi/README.md` chama de
"definição de pronto", não foram.

---

## Achados no trabalho do próprio orquestrador

Registrados aqui porque omiti-los tornaria o resto do dossiê menos confiável.

**O aceite de oráculo, escrito por mim para este portão, tem dois defeitos que
E5 encontrou (M5), ambos confirmados:**

1. **C9 tem assertiva vacuamente verdadeira.** `[].every(...)` é `true` — a
   assertiva passa se não houver nenhuma fonte descartada. Na execução houve, e o
   caso testou algo; mas é tautologia latente, da mesma classe que critiquei no
   aceite de autorização.
2. **C4 afirma no nome uma assimetria que a implementação não tem.** Escrevi
   *"derrubar o agregador custa menos que derrubar a fonte primária"* e testei um
   lado só. Traçando `contarIndependentes` com o CEPEA fora: o agregador forma
   grupo próprio e o resultado é igualmente 3 independentes. O contrafactual não
   foi executado, e ele é justamente o caso perigoso de K6.

Acrescentei casos de CONTROLE aos casos C7 depois de descobrir que passavam com
`fontes=0`, escrevi a autocrítica no próprio roteiro — e **não estendi a mesma
disciplina a C4 e C9**. Corrigir metade de um defeito e documentar a correção é
como o defeito restante sobrevive à revisão.

**Um terceiro caso, na prova de K3.** A primeira sonda devolveu
`LINHA AUSENTE — reidentificação impossível`, e a conclusão preguiçosa seria "E2
errou". A sonda computou o HMAC com o valor padrão `'dev'` enquanto o processo do
compliance carregava a variável real. Consultar a tabela diretamente mostrou a
linha eliminada com `documento_hmac` intacto. **Nos três casos o resultado
inválido era o favorável ao sistema.**

---

## O que está provado a favor do sistema

Os três pareceres convergem em pontos que merecem registro, porque um dossiê que
só lista defeitos não informa decisão:

- **Nenhuma rota escreve no registro.** E3 leu os cinco contratos integralmente e
  confirmou: não existe caminho que corrija o registro a partir do token. P1,
  nesse aspecto específico, é estrutural.
- **`AncoraRegistro` imutável, com `somenteEspelho`, revertendo na segunda
  âncora, e a baixa não devolve a âncora ao pool** — executado por E3.
- **`novaRefOpaca` é genuinamente aleatória**, `randomBytes(16)`, sem derivação de
  documento em nenhum caminho — E2 percorreu todos.
- **Uma chave AES por titular, fora do banco** — o desenho do crypto-shredding
  está certo; o defeito K3 está numa *segunda* chave que o desenho não tratou
  como chave.
- **`contratual_exige_redundancia`** torna impossível *configurar* leitura
  contratual de fonte única — impossibilidade estrutural, não verificação.
- **`ST_Area(geom::geography)`**, cruzamento no PostGIS e recusa de geometria
  inválida em vez de correção silenciosa — E5 confirma os três.
- **A linhagem de preço e registro responde de fato o que foi descartado e por
  quê**, com a causa verdadeira e não um genérico "fonte caiu". E5 chama de "o
  melhor pedaço de linhagem do sistema".
- **`efetiva()` distingue "vigente na janela" de "as fontes estão de pé agora"**,
  com aviso textual — a prociclicidade fica à vista de quem decide.
- **O timelock de `ControleAcesso` é real no código**, e não só no NatSpec: a
  correção do SMC-005 foi feita de verdade (E3 verificou que `propor` não encurta
  prazo de proposta existente).

---

## Condições mínimas para reapresentação

Sintetizadas dos três pareceres, sem acréscimo do orquestrador.

**Bloqueantes (os onze críticos):**

1. `inicializar` com controle de acesso, ou deploy atômico (K1).
2. Separar o papel que congela do que sai do congelamento; remover `CONGELADO`
   de `executar`, **e corrigir `cobertura.test.cjs:118-129`, que hoje assere o
   defeito como requisito** (K2).
3. Chave do índice cego por titular, ou destruição de `documento_hmac` na
   eliminação — com teste que **falhe** se a reidentificação ainda for possível
   (K3).
4. Decidir explicitamente o destino da geometria na eliminação, e declarar em
   `retencao_obrigatoria` o que permanecer, com fundamento e prazo (K4).
5. Serializar a escrita da trilha: `pg_advisory_xact_lock` ou `SELECT … FOR
   UPDATE` sobre a ponta (K5).
6. `contarIndependentes` por union-find sobre o fecho transitivo e simétrico,
   com ordenação determinística das fontes (K6).
7. `LIMITROFE` também para `ST_DWithin(talhao, desmatamento, resolucao_m/2)` com
   interseção nula; derrubar `conforme_sem_sobreposicao` (K7).
8. Resolver base por `(codigo, versao)` fixada na evidência; recusar base com
   zero feições carregadas (K8).
9. Constraint de exclusão espacial entre produtores distintos, e
   `WHERE produtor_id = EXCLUDED.produtor_id` no `DO UPDATE` (K9).
10. Redundância geoespacial real, ou ADR declarando a premissa como o ADR-0006
    exige para o simulador de registradora (K10).
11. Implementar `Idempotency-Key`, ou retirá-lo do contrato congelado (K11).

**Estruturais, sem os quais os críticos voltam:**

- Estender o P2 de `validar-abis.mjs` a eventos, a `bytes` e a `contracts/src/`,
  **provado por mutação no CI** (E2 A1, E3 M5).
- As dez invariantes ausentes que E3 enumera, com destaque para a nº 3
  ("nenhuma transição sai de CONGELADO sem `PAPEL_RECONCILIADOR_HUMANO`"), que
  pega K2 de imediato.
- Bijeção entre rota declarada e implementada, ou invariantes aplicadas sobre os
  controladores (G2-O-03).
- Casos de `GEOESPACIAL`, `DEGRADADA`, dispersão e disputa no aceite de oráculo
  (E5 M4) — e controle em C4 e C9 (E5 M5).
- Alinhar o CHECK de PII da trilha ao de `ops.texto_sem_pii`, e fazer o teste de
  conformidade exercitar o CPF **sem** pontuação (E2 A2).

---

## Situação

**Portão reprovado. Aguardando decisão humana.**

Nada foi corrigido. Corrigir antes do painel decidir seria suavizar o resultado,
e a regra do portão é o contrário disso.

Os pareceres íntegros estão em `e2-privacidade.md`, `e3-seguranca-contratos.md` e
`e5-dados-geoespacial.md`. A evidência e as reproduções estão em `evidencia/`.
