# Parecer E1 — Jurista regulatório (CVM/BCB/SUSEP)

- **Especialista:** E1 — Jurista regulatório. Viés declarado: presumo que a
  plataforma será fiscalizada e avalio se ela sobrevive a isso.
- **Portão:** G1 — Fronteira regulatória e coerência econômica (veto de E1).
- **Data:** 2026-09-18
- **Objeto:** artefatos congelados da Fase 0 — `docs/contracts/` (openapi, db,
  abi, events), `contracts/interfaces/`, `docs/adr/`, `CLAUDE.md`,
  `infra/ci/`, `.github/workflows/ci.yml` e os `AGENT.md` de domínio.
- **Critério aplicado:** a arquitetura proposta, *se implementada como
  especificada*, desloca a empresa para o perímetro de valor mobiliário, de
  PSAV ou de contraparte central? Avaliei especificação, não ausência de
  código.

---

## VEREDICTO: **REPROVADO**

Não é reprovação por risco difuso nem por conservadorismo de ofício. É
reprovação por três defeitos concretos e verificáveis no conjunto congelado.

Primeiro: a interface congelada do espelho autoriza **fracionar o título e
transferir frações a terceiros**, e o restante do conjunto congelado — catálogo
de divergências, catálogo de eventos, modelo de dados — **não tem como saber
que isso aconteceu**. A titularidade em `ops.contrato` é, por definição escrita
no próprio arquivo, "o titular segundo o REGISTRO". Uma fração que muda de mãos
na cadeia sem cessão registrada não produz divergência, não produz evento e não
produz congelamento. A tese central do MVP — "o registro prevalece, e a
divergência é detectável" — tem um buraco exatamente no eixo em que o
deslocamento para o perímetro de valor mobiliário ocorre: circulação de frações
de um título entre uma pluralidade de detentores, com marcação a mercado
publicada pela plataforma e absorção de perda por fundo mutualizado.

Segundo: duas espécies de garantia foram enumeradas em contrato congelado —
`FUNDO_MUTUALIZADO` e `CAUCAO_TOKEN` — **sem um único artefato que as defina**,
enquanto o contrato que deveria abrigá-las declara, no mesmo repositório, que
não custodia e não movimenta valor. As duas implementações naturais dessas
enumerações atravessam a fronteira: a primeira, para o perímetro de operação de
seguro (competência SUSEP); a segunda, para custódia de ativo de terceiro. A
Fase 0 existe justamente para que A1 e A2 não precisem inventar; aqui elas
precisarão.

Terceiro, e o que torna os dois primeiros previsíveis: **a decisão de perímetro
regulatório não está registrada em lugar nenhum.** Quatro ADRs foram escritos
(rede, privacidade, quórum, upgradeability) e nenhum trata de valor mobiliário,
PSAV, contraparte central ou seguro. Uma busca por `CVM`, `valor mobiliário`,
`14.478`, `10.214`, `SUSEP` e `PSAV` em todo o repositório, excluído o briefing
e os arquivos de instrução dos agentes, retorna **zero ocorrências
substantivas**. O projeto tem uma tese de contenção regulatória boa — e não a
escreveu. Se um fiscal abrir esta tela amanhã, não há documento a lhe entregar;
há quatro ADRs sobre tecnologia e um comentário de código dizendo "fronteira
regulatória (P7)".

Registro, em favor do conjunto avaliado, o que **não** é problema, para que a
reprovação não seja lida como mais ampla do que é: não há rota de escrita no
registro a partir do estado on-chain (`registradora.yaml` expõe apenas `GET` em
`/titulos`); não há função `payable` no cofre de garantias; não há recebimento,
guarda ou repasse de recursos na liquidação (`core.yaml:264-267`); a
reconciliação é humana e indelegável; e a separação de papéis entre quem
espelha, quem concilia e quem reconcilia está corretamente desenhada. A
arquitetura está mais perto de aprovar do que o veredicto sugere. O que falta é
pequeno em volume e decisivo em consequência.

---

## ACHADOS

### A1 — CRÍTICO — Fração do espelho circula entre terceiros sem cessão registrada, e a arquitetura é cega a isso

**O que a especificação diz.** `contracts/interfaces/IERC3525.sol:41-46` congela
duas assinaturas de `transferFrom`: uma transfere valor entre tokens do mesmo
slot; a outra, `transferFrom(uint256 deTokenId, address para, uint256 valor)
returns (uint256 novoTokenId)`, **cria um novo token para um terceiro
endereço** — é a operação de fracionamento com entrega. O invariante I2
(`docs/contracts/abi/README.md:20`) confirma a intenção ao exigir fuzzing "com
sequência aleatória de transferências e fracionamentos". O único limite
imposto é o I9 (`docs/contracts/abi/README.md:27`): não transferir a endereço
não habilitado, sendo a habilitação concedida por
`contracts/interfaces/IRegistroParticipantes.sol:20`, que exige apenas hash de
atestação e prazo de validade.

**Onde a arquitetura fica cega.** Em `docs/contracts/db/ops/040_contrato_espelhado.sql:18`,
`credor_ref` é comentado como "titular atual segundo o REGISTRO". O catálogo
congelado de divergências (`docs/contracts/db/ops/020_dominios_e_enums.sql:55-68`)
cobre doze tipos, todos na direção registro → token; o tipo 2,
`CESSAO_NAO_REFLETIDA:57`, é definido como "titularidade mudou no registro".
**Não existe o tipo simétrico** — titularidade mudou na cadeia sem cessão no
registro — e o cabeçalho do arquivo (linhas 2-3) declara que acrescentar valor
à enumeração é mudança de contrato. O catálogo de eventos
(`docs/contracts/events/catalogo.json:5-22`) não tem nenhum evento de
transferência, fracionamento ou mudança de titularidade: dezoito tipos, nenhum
sobre quem detém o quê. E `ops.contrato` (040:29-35) guarda `token_id` e
`token_slot`, mas **nenhuma coluna de detentor on-chain** — não há contra o que
conciliar.

**Consequência regulatória.** Um instrumento fracionável, transferível a uma
pluralidade de adquirentes, cujo valor é marcado a mercado pela própria
plataforma (`040:81-83`), cuja perda é absorvida por um fundo mutualizado
(`020:82`) e cuja verificação de atributos depende inteiramente do esforço da
plataforma é, em substância, o conjunto de fatos que a CVM examina sob o
conceito aberto do art. 2º, IX, da Lei 6.385/76 — contrato de investimento
coletivo — nos termos consolidados pelo Parecer de Orientação CVM 40/2022
[#REF: não consultei o texto do Parecer em fonte primária nesta sessão; opero
com o enunciado da minha instrução de papel]. Nenhum artefato congelado
estabelece qualificação do adquirente, limite de dispersão ou vedação de oferta
a investidor não qualificado; `compliance.yaml` só conhece o lado do produtor,
e devolve `habilitado_a_originar` (`compliance.yaml:71-76`) — **não existe
onboarding, KYC ou suitability do comprador de risco em nenhuma OpenAPI
congelada**, embora `apps/web/AGENT.md:15-17` dedique uma superfície inteira a
ele.

**Consequência sob a lei da CPR.** O registro ou depósito em entidade
autorizada pelo BCB é condição de validade e eficácia da CPR e de seus
aditamentos — art. 12 da Lei 8.929/1994, com a redação dada pela Lei
13.986/2020 (conferido em fonte nesta sessão; ver Nota 1 sobre o prazo). A
plataforma que permite a circulação de frações fora do registro produz
detentores cuja posição não é oponível a terceiros, e o faz sem sequer
detectar. Isso não é risco de implementação: é o que a especificação congelada
autoriza.

**Norma aplicável.** Lei 6.385/76, art. 2º, IX; Parecer de Orientação CVM
40/2022 [#REF]; Lei 8.929/1994, art. 12, com redação dada pela Lei 13.986/2020.

---

### A2 — ALTO — `FUNDO_MUTUALIZADO` e `CAUCAO_TOKEN` congelados como enumeração, sem qualquer especificação, contra um cofre que declara não custodiar

**Evidência.** `docs/contracts/db/ops/020_dominios_e_enums.sql:79-83` congela
`ops.tipo_garantia` com dez espécies, entre elas `FUNDO_MUTUALIZADO` e
`CAUCAO_TOKEN`; `docs/contracts/openapi/core.yaml:403` replica a lista na
fronteira de API. Contra isso:

- `contracts/interfaces/ICofreGarantias.sol:7-11` afirma, em comentário de
  desenvolvimento, que o contrato "NÃO recebe, NÃO guarda e NÃO transfere
  valor", "não há função payable, não há receive nem fallback, e nenhuma função
  movimenta token de terceiro".
- `docs/contracts/db/ops/050_garantias_e_waterfall.sql:29-45` modela a garantia
  com tipo, nível, valor e estado de excussão. **Não há nenhuma tabela de
  aporte, contribuição, prêmio, sinistro, pagamento ou patrimônio do fundo**, e
  nenhuma coluna que registre quem detém um token caucionado.
- Nenhum ADR trata do assunto (`docs/adr/README.md:8-13`).

**Consequência.** A enumeração é contrato congelado e A2 terá de implementá-la.
As duas implementações naturais atravessam a fronteira que P7 proíbe. Um fundo
que recebe contribuições de uma coletividade de produtores e paga ao credor
diante de um evento futuro e incerto de inadimplência é, em substância,
operação de seguro, sujeita à competência da SUSEP e vedada a quem não tem
autorização para operar [#REF: não consultei o Decreto-Lei 73/1966 nem
normativo SUSEP em fonte primária nesta sessão]. E uma caução de token exige
que alguém detenha ou controle o token alheio durante a garantia: se esse
alguém for a plataforma, há custódia de ativo de terceiro, precisamente o que
`CLAUDE.md:36` e o próprio cofre proíbem.

Registro o argumento em sentido contrário, que a defesa da empresa teria e que
**o projeto não escreveu**: o espelho da CPR provavelmente não é "ativo
virtual" na acepção da Lei 14.478/2022, cujo art. 3º, parágrafo único, exclui
da definição as representações de ativos cuja emissão, escrituração, negociação
ou liquidação esteja prevista em lei ou regulamento (conferido em fonte nesta
sessão; a numeração do inciso não confirmei [#REF]) — e a CPR tem emissão e
registro previstos na Lei 8.929/1994. O argumento é bom. Ele não existe em
nenhum arquivo deste repositório, e um argumento que não está escrito não é
oponível a um fiscal.

**Norma aplicável.** Lei 14.478/2022, art. 3º e parágrafo único; competência
da SUSEP sobre operação de seguro (DL 73/1966) [#REF]; Briefing, Seção 2, P7.

---

### A3 — ALTO — A decisão de perímetro regulatório não está registrada, contrariando a regra que o próprio projeto impôs

**Evidência.** `docs/adr/README.md:8-13` lista quatro ADRs: rede distribuída,
privacidade, quórum de oráculos e upgradeability. Nenhum sobre a fronteira
regulatória. Busca no repositório inteiro (excluídos `docs/BRIEFING.md`,
`CLAUDE.md` e `.claude/agents/`) por `CVM`, `valor mobiliário`, `6.385`,
`14.478`, `10.214`, `PSAV` e `SUSEP`: nenhuma ocorrência. As únicas menções
normativas fora do briefing são duas linhas em `docs/adr/0004-upgradeability-contratos.md:107-108`
(art. 12 da Lei 8.929/1994, citado corretamente) e uma frase em
`0004:40` observando que a reemissão "poderia ser lida como novação".

O próprio projeto estabeleceu, em `CLAUDE.md:86-92` e em
`docs/adr/README.md:3-6`, que "não há decisão não registrada" e que um ADR
ausente significa que a decisão foi tomada sem deixar rastro, "que é pior".
A arquitetura tomou pelo menos cinco decisões de conteúdo regulatório —
fracionar o título, torná-lo transferível, restringir a circulação a
participantes atestados, criar um fundo mutualizado como nível do waterfall e
admitir caução de token — e não registrou nenhuma.

**Consequência.** O portão G1 pede que se avalie se a arquitetura sobrevive à
fiscalização. O dossiê que a empresa levaria a uma fiscalização hoje é
composto de comentários de código. Isso é insuficiente, e é o achado mais
barato de corrigir dos cinco.

**Norma aplicável.** Briefing, Seção 3.2, passo 5, e Seção 9.2; `CLAUDE.md:86-92`.

---

### A4 — MÉDIO-ALTO — O "teste automatizado de fronteira regulatória" exigido por P7 é uma lista de nomes proibidos, e não alcança nenhum serviço off-chain

**Evidência.** `CLAUDE.md:35-38` e `docs/contracts/abi/README.md:30-35` afirmam
que as proibições de P7 "existem como testes automatizados que falham se a
fronteira for cruzada". O teste é
`infra/ci/validar-abis.mjs:49-55`: uma lista de expressões regulares sobre
**nomes de função** (`^deposit`, `^custodiar`, `^novar`, `^stake`…), aplicada
em `62-82` exclusivamente às ABIs compiladas de `contracts/interfaces/*.sol`.
O workflow (`.github/workflows/ci.yml:44-51`) roda quatro validações — OpenAPI,
eventos, ABIs e esquema — e **nenhuma delas examina `services/`**.

**Consequência.** Um controle lexical não detecta novação nem interposição de
contraparte: detecta um nome. `vincularGarantia`, `registrarExcussao`,
`liquidar` e `conciliarAgora` passam por ele sem qualquer exame de substância.
E os caminhos onde a novação e a interposição de fato aconteceriam — a
liquidação mediante conciliação de pagamento (`core.yaml:256-286`), a excussão
e o percurso do waterfall, o fundo mutualizado do achado A2 — vivem em
`services/core`, fora do alcance do único teste existente. A afirmação de
`CLAUDE.md:37-38` é, quanto aos serviços, factualmente falsa no conjunto
congelado avaliado.

Anoto a assimetria: P2 (PII on-chain) recebeu controle preventivo real — um
`CHECK` de domínio no banco (`020:9-14`) que rejeita padrão de CPF, CNPJ e
e-mail na inserção. P7 recebeu uma lista de palavras. O princípio que este
portão existe para verificar é o pior instrumentado dos sete.

**Norma aplicável.** Lei 10.214/2001 (interposição de contraparte e novação em
sistema de compensação e liquidação) [#REF: não consultei o texto da lei em
fonte primária nesta sessão]; Briefing, Seção 2, P7, que exige a proibição
"como testes automatizados", não como recomendação em documento.

---

### A5 — MÉDIO — A oponibilidade das garantias reais a terceiros não é campo em lugar nenhum, e o waterfall simula como eficaz o que pode não ser

**Evidência.** `docs/contracts/db/ops/050_garantias_e_waterfall.sql:29-45`
modela `ops.garantia` com `registro_publico_ref` (linha 38, "matrícula/averbação
(sem nome de pessoa)"), mas **sem data de averbação, sem estado de averbação e
sem prazo**. Do outro lado da fronteira, `registradora.yaml:134-142` modela
`onus[].averbado_em` — a registradora sabe a data; o domínio não a guarda. A
divergência `GARANTIA_ALTERADA` (`020:61`, política em `080:97`) compara
existência de garantia, não sua oponibilidade. E
`050:14-24` atribui a cada nível do waterfall `cap_pct_exposicao`,
`haircut_pct` e `prazo_recuperacao_dias` — parâmetros de valor esperado — sem
que o grau de oponibilidade da garantia a terceiros seja sequer representável.

**Consequência.** As garantias reais vinculadas à CPR dependem, para valerem
contra terceiros, de averbação no cartório de registro de imóveis da situação
dos bens, em prazo contado da apresentação do título (art. 12 da Lei
8.929/1994, com a redação da Lei 13.986/2020 — conferido nesta sessão em fonte
secundária, que indica prazo de 3 dias úteis; não confirmei o dispositivo
exato em fonte primária [#REF]). Uma simulação de waterfall que absorve perda
no nível 2 com alienação fiduciária não averbada produz um número que o
comprador de risco lerá como colateral e que, em execução, é papel. O MVP
existe para produzir evidência que altera decisão de investimento; esta
produziria evidência que a altera na direção errada.

**Norma aplicável.** Lei 8.929/1994, art. 12 e seus parágrafos, com redação
dada pela Lei 13.986/2020.

---

## NOTAS SOBRE FONTES

**Nota 1 — correção ao enunciado da minha própria instrução de papel.** O
arquivo `.claude/agents/e1-jurista-regulatorio.md:33-38` manda citar o prazo de
registro ou depósito da CPR como **10 dias úteis**, com a redação da Lei
13.986/2020. Ao conferir nesta sessão, a fonte indica que a Lei 14.421/2022
alterou esse prazo para **30 dias úteis**, para CPR emitida a partir de
11/08/2022. Mantive a forma de citação exigida — art. 12 da Lei 8.929/1994, com
a redação dada pela Lei 13.986/2020, e não "art. 12 da Lei 13.986/2020" —, mas
registro que o prazo constante da instrução está desatualizado e que nenhum
achado deste parecer depende do número de dias.

**Verificado em fonte nesta sessão (busca web):** o art. 12 da Lei 8.929/1994 e
o regime de registro ou depósito como condição de validade e eficácia da CPR,
com a alteração posterior da Lei 14.421/2022; a exclusão, no art. 3º da Lei
14.478/2022, das representações de ativos cuja emissão, escrituração,
negociação ou liquidação esteja prevista em lei ou regulamento.

**Não verificado em fonte primária nesta sessão, marcado `[#REF]` no corpo:** o
texto do Parecer de Orientação CVM 40/2022; o texto da Lei 6.385/76, art. 2º;
o texto da Lei 10.214/2001; a competência da SUSEP e o Decreto-Lei 73/1966; a
numeração do inciso do parágrafo único do art. 3º da Lei 14.478/2022; e o
dispositivo exato que fixa o prazo de averbação das garantias reais.

**Fontes consultadas:**
- [Art. 12 da Lei 8.929/1994 — Planalto](https://www.planalto.gov.br/ccivil_03/leis/l8929.htm)
- [Lei nº 14.478/2022, art. 3º — Câmara dos Deputados](https://www2.camara.leg.br/legin/fed/lei/2022/lei-14478-21-dezembro-2022-793516-publicacaooriginal-166582-pl.html)

---

*E1 não propõe implementação e não indica como corrigir os achados. A
reprovação incide sobre a especificação avaliada, não sobre a tese do projeto,
que considero defensável e mal documentada.*
