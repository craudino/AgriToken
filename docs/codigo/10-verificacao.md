# 10. Verificação — o que cada validador realmente prova

> `infra/ci/` — 9 validadores, 998 linhas. Quase o tamanho do núcleo.

## 10.0 Por que tanto validador

Não é zelo. É consequência direta de G1.

Três revisores independentes — E1 (jurista regulatório), E6 (economista
institucional) e um red team declarado — encontraram, em artefatos que os testes
da própria construção declaravam cobertos, achados como estes:

- o timelock de papéis sensíveis **existia só no NatSpec**;
- a verificação de P7 alcançava seis interfaces Solidity e **nenhum serviço**;
- a saída do congelamento aceitava uma **string** como prova de reconciliação.

O padrão comum: **a garantia estava no comentário, não no código.** A resposta
foi transformar cada princípio da Seção 2 em teste que falha quando a fronteira
é cruzada.

Daí a proporção. Os validadores somam quase o mesmo que o núcleo, e isso é
deliberado.

---

## 10.1 `npm run validar` — a sequência

```bash
npm run validar   # tudo, na ordem
```

| Comando | Verifica | Princípio |
|---|---|---|
| `validar:openapi` | Lint 3.1 + invariantes de fronteira | P7 |
| `validar:eventos` | Esquemas, exemplos, canonicalização, PII | P5, P6, P2 |
| `validar:contratos` | Compila interfaces, compara ABIs congeladas | P7 |
| `validar:tipos` | Tipos gerados sincronizados com o contrato | P6 |
| `validar:p7` | Fronteira regulatória no código-fonte | P7 |
| `validar:escopos` | Toda rota declara escopo | P7 |
| `validar:compose` | Topologia, variáveis, referências | — |
| `validar:web` | Jargão e carga cognitiva no fluxo do produtor | — |
| `validar:esquema` | Bases efêmeras + conformidade do DDL | P1, P2, P4, P5 |

Fora da sequência, porque exigem a pilha de pé:
`validar:pii-cadeia`, `aceite:conciliacao`, `aceite:auth`.

Estado atual: **56 verificações OK**.

---

## 10.2 `validar:p7` — o validador que nasceu de um achado

```js
// SMC-003 — fronteira regulatória (P7) verificada no código-fonte, não só nas
// ABIs. Em G1, E1 e o red team apontaram que a verificação de P7 alcançava
// apenas seis interfaces Solidity, deixando de fora justamente os serviços,
// onde novação, interposição e promessa de rendimento de fato ocorreriam. O
// CLAUDE.md afirmava que o controle existia; era verdade para as interfaces e
// falso para o resto.
```

A última frase é o achado inteiro: a afirmação era verdadeira sobre o que
verificava e falsa sobre o sistema.

Hoje varre `services/`, `apps/`, `contracts/` e `infra/`, em `.ts`, `.tsx`,
`.js`, `.mjs`, `.sol`, `.sql`, `.json`, `.md`, `.yaml`.

**Duas categorias de detecção:**

**1. Identificadores que denunciam travessia.**

```js
{ re: /(custodiar|custody|guardarAtivo|depositarAtivo)/i, o: 'custódia de ativo de terceiro' },
{ re: /(novar|novacao|substituirObrigacao)/i,             o: 'novação' },
{ re: /(assumirContraparte|interporContraparte|garantirLiquidacao)/i, o: 'interposição como contraparte' },
{ re: /(prometerRendimento|garantirRetorno|distribuirRendimento)/i,   o: 'promessa de rendimento' },
{ re: /(escreverNoRegistro|atualizarRegistro|corrigirRegistro)/i,     o: 'escrita no registro (P1)' },
```

**2. Promessa de rendimento no texto exibido.**

```js
// O red team lê os nomes e os textos, não as intenções: a expectativa jurídica
// nasce do que se exibe.
```

Esta é a parte que um validador ingênuo omitiria. A caracterização de valor
mobiliário depende da **expectativa** criada no investidor, e expectativa nasce
do texto da tela, não da arquitetura interna. Uma página que diga "rendimento
garantido de 12% ao ano" cruza a fronteira independentemente do que o contrato
faça. [#REF]

### A isenção, e por que ela não é buraco

```js
// Este próprio arquivo e os documentos que discutem a fronteira citam os
// padrões proibidos por necessidade. Discutir a proibição não é violá-la.
const ISENTOS = new Set(['infra/ci/validar-p7.mjs', 'infra/ci/validar-abis.mjs']);
```

Dois arquivos, nomeados explicitamente. Sem isso, a alternativa seria o
validador reprovar a si mesmo — e a saída preguiçosa seria parar de nomear os
padrões, o que piora o código para agradar o validador. A isenção é estreita e
visível no diff.

---

## 10.3 `varrer-pii-cadeia.mjs` — e o autoteste

```js
// Percorre TODOS os blocos e examina calldata, logs e tópicos — não apenas os
// eventos que o sistema decidiu decodificar, porque o vazamento que importa é
// justamente o que ninguém previu.
```

Não decodifica ABI. Extrai **qualquer trecho ASCII legível** de qualquer blob
hexadecimal e procura CPF, CNPJ, e-mail, telefone e coordenada.

```js
// Texto ASCII em calldata é o vetor mais comum: alguém acrescenta um campo
// "observação" e o CPF entra junto.
```

### O autoteste

```js
// Autoteste do detector. Um varredor quebrado passa silenciosamente e dá
// garantia falsa — que é pior que garantia nenhuma, como o painel apontou em
// G1. Antes de varrer a cadeia, o detector prova que detecta.
```

Quatro casos com PII são injetados no detector, e o validador **falha se o
detector não os acusar**. Depois varre a cadeia.

Esta é a ideia mais importante deste documento inteiro. Um validador sem
autoteste tem um modo de falha silencioso: uma expressão regular quebrada num
refactor passa a aceitar tudo, o CI continua verde, e a equipe fica mais
confiante enquanto a proteção desapareceu.

**Garantia falsa é pior que garantia nenhuma**, porque remove a vigilância que
existiria sem ela.

O mesmo padrão está na varredura de PII de `validar:eventos`.

---

## 10.4 `validar:escopos` — estático antes de dinâmico

```js
// A guarda já recusa rota sem escopo em tempo de execução, mas descobrir isso
// em produção é descobrir tarde. Aqui a verificação é estática: rota nova sem
// decorador não passa no CI.
```

Varre os `*.controller.ts` e exige `@Escopos()` ou `@Publica()` em cada
`@Get`/`@Post`/`@Put`/`@Patch`/`@Delete`. Conta rotas, públicas e uso por escopo.

Duas camadas para a mesma regra: a guarda recusa em execução, o validador recusa
em CI. A segunda existe porque a primeira só fala quando alguém chama a rota —
e uma rota esquecida pode ficar meses sem ser chamada por quem deveria, e ser
chamada por quem não deveria.

**Foi este validador que reprovou a minha própria rota pública `/saude/pronto`**
(`06-servicos.md` §6.6). Escrevi a rota, o validador recusou, e a recusa estava
certa.

---

## 10.5 `validar:contratos` — ABI congelada

```js
// Compila as interfaces de W1, congela as ABIs em docs/contracts/abi/ e
// verifica as fronteiras que precisam existir como código, não como promessa.
```

Compila com `solcjs` local (sem rede), compara com as ABIs congeladas e reprova
divergência. `--gerar` regrava — e usar essa flag é mudança de contrato, que
exige SMC.

Verifica também as fronteiras estruturais: nenhum `payable`, `receive` ou
`fallback` em `CofreGarantias`; nenhum `string` em parâmetro de evento (P2).

---

## 10.6 `validar:esquema` — bases efêmeras

Sobe três bases descartáveis, aplica o DDL inteiro e roda
`docs/contracts/db/testes/*.sql`.

O que se prova aqui é **recusa**: cada teste executa um ataque e falha se o
banco aceitar (`03-modelo-de-dados.md` §3.10).

---

## 10.7 O que foi verificado empiricamente

Distinção que este repositório trata com cuidado: **teste que passa** não é
sinônimo de **propriedade demonstrada**. Estes foram exercitados contra a
condição real:

| Propriedade | Como foi verificada | Resultado |
|---|---|---|
| Detecção de divergência | 14 tipos injetados no simulador | 13 detectados; 1 nomeado como não detectado |
| Latência de detecção | Medida por tipo | 85–130 ms (registro), ~4,3 s (cadeia) |
| Invariantes dos contratos | 61 testes, `solidity-coverage` | 100% linhas/funções, 90% ramos |
| Autorização | 21 casos | 21/21 |
| Ponta a ponta | 20 passos | saída 0 |
| PII na cadeia | Varredura com autoteste | nenhum achado; detector provado |
| Crypto-shredding | Destruir chave e **tentar decifrar** | `FALHOU_COMO_ESPERADO` |
| Detecção de drift de migração | **Alterei** uma migração aplicada | parou com diagnóstico correto |
| Trava de agenda | Trava segurada por `psql` externo | core cedeu 3 vezes |

As três últimas são as que valem mais, porque foram verificadas **provocando a
condição de falha** em vez de observando o caminho feliz. Um teste de
crypto-shredding que só verifica se `eliminado_em` foi preenchido não distingue
eliminação de fingimento.

---

## 10.8 Os defeitos que os próprios testes tinham

Esta seção existe porque a lista anterior seria enganosa sem ela.

### O teste tautológico

```js
codigo === 404 ? 201 : 201      // passava sempre
```

Em `aceite-auth.mjs`, meu próprio arquivo. Verde em qualquer resultado. Exatamente
o defeito que este projeto vinha apontando nos outros.

### O caso-limite que não era limite

O polígono `LIMITROFE` era meramente adjacente à área de desmatamento — zero
sobreposição. O motor devolvia `CONFORME`, o teste passava, e o caso-limite
nunca foi exercitado (`09-operacao.md` §9.5).

### O endpoint de saúde com a falha que o sistema previne

O relatório de degradação do oráculo contava fontes **brutas**, não
independentes — precisamente a redundância aparente que `contarIndependentes()`
existe para evitar. A regra estava certa num lugar e reimplementada errada em
outro.

**O padrão comum aos três:** o teste afirmava algo que não verificava. É a mesma
patologia dos achados de G1, um nível acima — e a razão de cada validador novo
precisar responder "o que exatamente isto prova, e como sei que ainda prova?".

---

## 10.9 O que não está verificado

De `docs/ESTADO-DO-PROTOTIPO.md`, sem atenuação:

**Das oito lacunas informacionais:**
- 2 resolvidas;
- 2 resolvidas **contra o simulador** — o que prova o mecanismo, não o
  comportamento contra uma registradora real, que tem latência,
  indisponibilidade e semântica próprias;
- 3 parciais;
- 1 **não resolvida** — F7, disposição do credor a pagar pela verificação.
  Exige credor real; o protótipo não tem. Nenhuma linha de código resolve essa.

**Nunca executado:** a composição Docker, a rede Besu, os portões G2 e G3.

**Não testado:** carga, concorrência real, recuperação de falha, acessibilidade.

**Não existe:** observabilidade além de log, backup, gestão de segredos,
identidade de usuário final.

---

## 10.10 O critério para validador novo

Do que este repositório aprendeu:

1. **Tem autoteste?** Se ele pode quebrar em silêncio, ele vai.
2. **O que exatamente prova?** "Verifica P2" não basta; "recusa CPF em calldata,
   e prova que recusa" basta.
3. **Alcança o sistema todo ou só o que é fácil?** A verificação de P7 alcançava
   seis interfaces e passava.
4. **A isenção é estreita e nomeada?** Isenção por padrão genérico vira buraco.
5. **Reprova quem o escreveu?** Um validador que nunca reprovou nada do autor
   provavelmente está medindo o que o autor já fazia.

---

**Próximo:** [11. Glossário](11-glossario.md).
