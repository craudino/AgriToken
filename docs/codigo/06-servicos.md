# 6. Serviços — cada um, e por que são separados assim

> `services/core` (9 arquivos, 1.436 linhas), `services/oracle` (6/671),
> `services/eudr` (6/666), `services/compliance` (8/659), mais
> `infra/simulador-registradora` (4/258). NestJS 11 sobre Fastify.

## 6.0 O critério da divisão

A fronteira entre serviços **não** foi traçada por tamanho nem por camada
técnica. Foi traçada por **quem pode ver o quê**:

| Serviço | Vê | Nunca vê |
|---|---|---|
| `core` | Domínio operacional, cadeia | PII, geometria bruta |
| `oracle` | Fontes externas, quórum | PII, domínio de contrato |
| `eudr` | **Geometria bruta** (papel `cpr_geo`) | PII, cadeia |
| `compliance` | **PII** (papel próprio, base própria) | Cadeia, geometria |

Este é o desenho que torna a separação verificável. `core` não tem credencial de
`cpr_pii` — não é que ele "não deva" acessar o cofre: ele **não consegue**.
`eudr` é o único com o papel `cpr_geo`, e o painel de auditoria (`cpr_ro`) tem o
acesso ao schema `geo` explicitamente revogado.

Serviço dividido por camada ("api", "workers", "jobs") teria todos os quatro
acessos em todos os processos, e a separação seria convenção.

---

## 6.1 `services/core` — o domínio

### `conciliacao.service.ts` — a peça central

É a **lacuna informacional nº 1** e a peça cuja falha derruba a arquitetura
inteira: com que frequência registro e token divergem, e em quanto tempo isso é
detectado.

```ts
/**
 * P1 governa cada linha: não existe aqui nenhum caminho que escreva no registro
 * a partir do estado on-chain.
 */
```

O ciclo, em `executar()`:

1. Abre uma execução em `ops.conciliacao_execucao`;
2. para cada contrato espelhado, compara **nos dois sentidos**;
3. registra divergências, congela conforme a política;
4. detecta registros **sem** espelho;
5. fecha a execução com contagem e duração.

**Leitura do registro passa pelo oráculo** (`POST /leituras/coletar`), não por
chamada direta à registradora. O motivo é P4: o estado registral é leitura
crítica, e leitura crítica exige quórum. Sem isso, uma registradora comprometida
ou com bug decidiria sozinha o que o sistema trata como verdade.

E quando o quórum não fecha:

```ts
// Sem quórum não se conclui nada: a ausência de conclusão é sinalizada,
// não convertida em "está tudo certo" (P4).
```

Esta linha é a diferença entre um sistema honesto e um sistema perigoso. O
caminho fácil seria tratar falha de leitura como "nenhuma divergência
encontrada". O placar mostraria verde, e o verde significaria cegueira.

#### Os dois sentidos

`conciliarContrato()` cobre registro → token: baixa, estado, valor de face,
quantidade, vencimento, ônus, cessão, garantias, hash documental.

`conciliarLadoToken()` cobre token → registro, e existe por SMC-004:

```ts
/**
 * Antes de SMC-004 o catálogo só enxergava o sentido inverso, e a fração podia
 * circular fora do registro sem que ninguém visse — achado A1 de E1 em G1.
 */
```

Lê eventos `TitularidadeAlterada` da cadeia e compara com as cessões
registradas. Mais transferências on-chain que cessões no registro →
`TRANSFERENCIA_SEM_CESSAO` ou, se criou token novo,
`FRACIONAMENTO_NAO_REFLETIDO`.

A latência dos dois lados é diferente e a diferença é informativa: **~125 ms do
lado registro, ~4,3 s do lado cadeia** — varrer eventos custa mais que comparar
campos. É o tipo de número que só aparece medindo.

#### `marcarConforme()` — a ausência que precisa ser positiva

```ts
/**
 * A passagem exige conciliação efetivamente executada, não a simples ausência
 * de notícia ruim. Para quem olha de fora, ausência de divergência e ausência
 * de conciliação são indistinguíveis; a transição registrada é o que as separa.
 */
```

O contrato só sai de `ESPELHADO` para `ATIVO` com uma transição registrada,
guardada `conciliacao_inicial_conforme`. Um sistema que nunca rodou a
conciliação e um sistema que rodou e não achou nada produzem o mesmo silêncio;
a transição é o que os distingue no registro.

#### `registrarDivergencia()` — a ordem que custou um bug

```ts
// A ordem importa e custou um bug: a trava de SMC-001 recusa qualquer
// transição em contrato já congelado, inclusive a que registra a entrada em
// disputa. Primeiro o contrato entra em disputa; só então congela.
```

O gatilho `tg_bloqueia_congelado`, escrito para impedir manipulação, bloqueava o
próprio fluxo legítimo de congelamento. A correção foi inverter a ordem no
serviço, **não** afrouxar o gatilho. Ver `03-modelo-de-dados.md` §3.3.

Também: divergência já aberta do mesmo tipo no mesmo contrato **não duplica
incidente**. Sem isso, um ciclo a cada 60 segundos produziria 1.440 incidentes
por dia para a mesma causa, e o painel de incidentes viraria ruído.

#### `reconciliar()` — a porta humana

```ts
if (!/^OP-[A-Z0-9-]{3,}$/.test(operador)) throw new Error('operador precisa ser identificador funcional humano…');
if (justificativa.length < 20) throw new Error('justificativa insuficiente');
```

Duas recusas que parecem burocráticas e não são. O padrão `OP-…` impede que um
serviço se passe por operador; o mínimo de justificativa impede o "ok" que não
explica nada. A justificativa vai **em hash** para a trilha, e o texto fica
truncado em 200 caracteres — texto livre de operador é o lugar mais provável
para aparecer um nome próprio.

O descongelamento só acontece se **nenhuma outra divergência** estiver aberta —
regra duplicada no serviço e no gatilho, de propósito.

### `originacao.service.ts` — e a correção que a autenticação forçou

```ts
/**
 * Não recebe nome, documento nem polígono: o produtor entra por referência
 * opaca (P2), e a habilitação vem do compliance como atestação — o núcleo
 * nunca vê o dossiê que a sustenta.
 */
```

`registrar()` teve de ser **reescrito**. A versão original escrevia o título no
simulador de registradora para depois lê-lo de volta — ou seja, o núcleo
fabricava a verdade registral que depois tratava como fonte.

Ninguém notou até a autenticação entrar: o token de perfil `servico` não tem
`simulador:operar`, e a chamada passou a ser recusada. A recusa expôs uma
violação de P1 que estava escondida em código que funcionava.

Hoje `registrar()` **lê e confirma**: consulta o título na registradora e só
avança se ele existir com os termos esperados. Quem emite o título nos roteiros
de demonstração é um ator emitente separado (`registrarComoEmitente`), como
seria na realidade.

Esta é a melhor evidência a favor de autorização estrita: **um controle de
acesso bem-feito encontra violações de princípio que revisão de código não
encontrou.**

### `agenda.service.ts` — o SLA que era coluna de tabela

```ts
/**
 * Até aqui a conciliação só rodava quando alguém chamava a rota. O SLA de
 * quinze minutos de `ops.politica_divergencia` era uma coluna de tabela, não um
 * comportamento — e um SLA que ninguém cumpre é pior que SLA nenhum, porque
 * cria a impressão de vigilância.
 */
```

Três tarefas, três travas consultivas:

| Tarefa | Intervalo padrão | Trava |
|---|---|---|
| `conciliacao` | 60 s | 1001 |
| `sentinela-sla` | 120 s | 1002 |
| `integridade-trilha` | 600 s | 1003 |

**Trava consultiva do PostgreSQL** (`pg_try_advisory_lock`) para eleição de
líder. Com duas réplicas, dois laços rodariam em paralelo e duplicariam
incidente. A trava é por tarefa, não por processo, e **some sozinha se o
processo morrer** — o que elimina a classe de falha em que um nó morto mantém a
liderança para sempre.

**Sem sobreposição:** o laço reagenda a partir do **fim**, não do início. Uma
conciliação que demora 90 s com intervalo de 60 s não dispara a seguinte por
cima de si mesma.

Verificado empiricamente: com uma trava segurada externamente por `psql`, o core
cedeu três vezes seguidas e registrou `tarefa já em execução em outra réplica`.

`sentinelaSla()` alerta sobre duas coisas. Divergência aberta além do prazo, e —
mais importante — **silêncio da conciliação**:

```ts
// Conciliação parada é pior que divergência aberta: para quem olha de fora,
// ausência de divergência e ausência de conciliação são a mesma coisa.
```

`integridadeTrilha()` roda `verifica_cadeia()`: *"o alerta mais importante e o
mais esquecido"*.

### `waterfall.service.ts` — duas escolhas que um economista cobra

```ts
/**
 * 1. O seguro agrícola cobre quebra de produtividade, não queda de preço.
 *    Tratá-lo como colchão genérico é o erro que faz o fundo parecer suficiente
 *    no papel e insuficiente na safra ruim.
 * 2. Garantia real não averbada não absorve nada. Sem oponibilidade, o que
 *    existe é expectativa de recuperação, não colateral (SMC-006).
 */
```

Ambas tornam os resultados **piores** e mais verdadeiros. A segunda veio de
SMC-006: o modelo original contava garantia real independentemente de averbação,
o que superestima a recuperação exatamente no cenário em que ela importa.

Determinístico por semente (P6): mesma entrada, mesmo hash de resultado.

### `mercado.service.ts` e `liquidacao.service.ts`

`mercado` marca a mercado a partir de leitura de oráculo, e **leitura em disputa
não move MTM** — regra também no comentário do DDL de `ops.contrato.valor_mtm`.

`liquidacao` trata pagamento e baixa. A transição `→ LIQUIDADO` exige
`pagamento_conciliado_e_baixa_no_registro`: as duas coisas, não uma.

---

## 6.2 `services/oracle` — quórum e o perigo da redundância aparente

### `contarIndependentes()`

```ts
/**
 * Dois agregadores que republicam o mesmo boletim parecem duas fontes e são
 * uma — e redundância aparente é pior que ausência de redundância, porque induz
 * confiança injustificada (ADR-0003).
 */
```

Agrupa fontes por correlação declarada (`ops.fonte_oraculo.independente_de`) e
conta **grupos**, não fontes. Duas fontes correlacionadas contam como uma, e o
quórum de P4 não fecha.

Este é o defeito mais sutil que o sistema previne. Contar fontes brutas daria
"quórum de 2" com uma única fonte de informação por trás — e o sistema estaria
mais confiante, não menos, do que se tivesse uma fonte declarada.

O mesmo defeito reapareceu no endpoint de saúde do oráculo, que contava fontes
brutas no relatório de degradação. Corrigido para usar `contarIndependentes`: a
lição é que uma regra implementada em um lugar tende a ser reimplementada errado
em outro, e o remédio é a função compartilhada.

### Dispersão

```ts
// Dispersão acima da tolerância não é média: é sinal de que as fontes
// discordam, e discordância não se resolve tirando média.
```

Fontes fora da tolerância → `SEM_QUORUM`, não média. O valor médio entre duas
fontes que discordam em 30% não representa nada.

### Estados da leitura

`COLETANDO`, `EFETIVA`, `DEGRADADA`, `SEM_QUORUM`, `EM_DISPUTA`, `INVALIDADA`.

`DEGRADADA` é o estado que reconhece o caso comum: quórum mínimo atingido, mas
abaixo do desejado. Produz decisão **com sinalização**, para que o painel mostre
que a informação é mais fraca que o normal em vez de escondê-lo.

### `arquivarBruto()`

Toda resposta de fonte é arquivada por hash antes de qualquer agregação. Sem o
bruto, "com base em quê" (P5) é irrespondível: sobraria o número agregado e
nenhum meio de recomputá-lo.

### `POST /leituras/fonte`

Rota acrescentada quando a autenticação expôs que o EUDR publicava resultados
via `/sim/geo` — superfície de simulação. Hoje há caminho legítimo, com escopo
próprio (`oraculo:publicar-fonte`). Mesmo padrão do caso da originação:
**a autorização estrita revelou um acoplamento indevido.**

---

## 6.3 `services/eudr` — geometria e incerteza

### A margem derivada, não escolhida

```sql
(ST_Perimeter(t.geometria::geography) * (b.resolucao_m / 2.0)) / 10000 AS margem_ha
-- o erro do cruzamento mora nas bordas, e a faixa duvidosa é o perímetro do
-- talhão vezes meia resolução da base. Constante escolhida a dedo
-- classificaria como conforme o que é apenas indistinguível.
```

A margem de incerteza vem da **resolução da base de referência** e do perímetro
do talhão. Uma constante arbitrária (SMC-009/010) classificaria como conforme o
que é apenas indistinguível do conforme.

```ts
/**
 * Resultado LIMITROFE nunca vira CONFORME. Sobreposição dentro da margem de
 * erro da base é incerteza, e classificar incerteza como conformidade contamina
 * o colateral e a DDS emitida.
 */
```

Quatro resultados: `CONFORME`, `NAO_CONFORME`, `LIMITROFE`, `INCONCLUSIVO`. Os
dois últimos existem porque a realidade os produz, e forçá-los para um dos dois
primeiros seria fabricar certeza.

### A data de corte na tabela

```ts
/**
 * A data de corte é 31/12/2020 e vive na tabela da base, não no código: a
 * aplicação do Regulamento (UE) 2023/1115 já foi adiada mais de uma vez — a
 * mais recente pelo Regulamento (UE) 2025/2650, para 30/12/2026 (grandes
 * operadores) e 30/06/2027 (micro e pequenas).
 */
```
[#REF]

A data de corte não mudou nos adiamentos, mas os prazos de aplicação mudaram
duas vezes. Regra regulatória com histórico de mudança vira dado, não constante.

### Quórum por interseção

```ts
/**
 * Uma base apontando problema já impede o resultado conforme — a redundância
 * aqui serve para não perder o alerta, não para tirar média.
 */
```

Para preço, quórum é mediana. Para desmatamento, é **interseção**: qualquer base
que detecte sobreposição impede o selo. A política de agregação é por tipo de
leitura porque a assimetria de custo é por tipo: falso negativo em desmatamento
custa muito mais que falso positivo.

### `geo.service.ts` — recusar em vez de corrigir

```ts
/**
 * Recusa geometria inválida em vez de "corrigir": um polígono autointersectante
 * corrigido em silêncio produz área errada, e a área errada vira colateral
 * errado.
 */
```

Validação topológica pelo **PostGIS**, não por código de aplicação: *"'confia no
meu loop' não é evidência"* (P6).

Centroide ofuscado ≥ 5 km para o painel. Coordenada de propriedade rural
identifica o titular melhor que o endereço.

#### O polígono sintético que passava por acidente

O gerador de massa criava o talhão `LIMITROFE` meramente **adjacente** à área de
desmatamento — zero sobreposição. O motor devolvia `CONFORME`, o teste passava,
e o caso-limite nunca era exercitado. O teste verde afirmava o contrário do que
verificava.

Corrigido: o gerador cria faixa de sobreposição de ~9 m, dentro da margem
derivada da resolução da base. Hoje o caso produz `LIMITROFE` de verdade.

---

## 6.4 `services/compliance` — o cofre

### `kms.ts`

```ts
/**
 * O ponto que importa não é o algoritmo: é que a chave não vive no banco de
 * PII. Se vivesse, comprometer a base entregaria dado e chave juntos, e o
 * crypto-shredding viraria teatro.
 */
```

AES-256-GCM, uma chave por titular, formato `iv || authTag || dados`. `KmsLocal`
é simulação de KMS gerenciado (ADR-0008) — mas a **propriedade** que importa
(chave fora da base) é real, e a substituição por um KMS gerenciado troca a
implementação sem mudar o desenho.

### `eliminacao.service.ts` — a eliminação que diz o que não eliminou

```ts
/**
 * A eliminação honesta diz o que **não** eliminou: registros sob obrigação
 * legal permanecem, pseudonimizados, e o pedido documenta o que ficou e sob
 * que fundamento.
 */
```

Retenção obrigatória citando fundamento — LGPD art. 16, I. [#REF] Um sistema que
respondesse "tudo eliminado" quando obrigações legais exigem retenção estaria
mentindo ao titular.

E a verificação que fecha o ciclo:

```ts
// Verificação de irreversibilidade: tentar decifrar e exigir a falha. É a
// evidência que a Seção 12 do briefing pede, e não vale afirmar sem tentar.
```

Depois de destruir a chave, o serviço **tenta decifrar** e exige que falhe.
`FALHOU_COMO_ESPERADO` é o resultado desejado; `SUCESSO_INESPERADO` é incidente.

A alternativa — marcar `eliminado_em` e confiar — é o que quase todo sistema faz,
e é indistinguível de não ter eliminado nada.

---

## 6.5 `infra/simulador-registradora`

Simula a registradora. **Não é serviço de produção** e não tem correspondente no
desenho-alvo: existe para que a conciliação possa ser investigada sem uma
registradora real.

Injeta os 14 tipos de divergência. Contenção em quatro camadas, descrita em
`03-modelo-de-dados.md` §3.7.

Uma limitação que o simulador não resolve, e que está registrada em
`docs/ESTADO-DO-PROTOTIPO.md`: **duas lacunas informacionais estão "resolvidas
contra o simulador", não contra a realidade.** Uma registradora real tem
latência, indisponibilidade, semântica de campo própria e interpretações que
divergem. O que está provado é que o mecanismo de detecção funciona, não que
funcionará contra uma contraparte real.

---

## 6.6 O que todos os serviços compartilham

- `main.ts` — bootstrap Fastify, `GuardaSimulador` **antes** de `GuardaEscopo`,
  CORS restrito por `origensPermitidas()`;
- `app.module.ts` — registro de provedores e da guarda global;
- `app.controller.ts` — rotas, cada uma com `@Escopos()` explícito;
- `/saude` público com veredito mínimo, `/diagnostico` com escopo.

### A divisão de `/saude`

Havia um `/saude/pronto` público que devolvia o estado das tarefas agendadas e
das conexões. **O próprio validador de P7 o reprovou:** sonda de prontidão
pública expõe topologia interna a qualquer um.

A correção separou os dois: `/saude` devolve veredito (`pronto: true|false`) e
nada mais; `/diagnostico` devolve o detalhe e exige escopo. Orquestrador precisa
do primeiro; operador precisa do segundo; nenhum dos dois precisa que o detalhe
seja público.

---

**Próximo:** [7. Autenticação](07-autenticacao.md).
