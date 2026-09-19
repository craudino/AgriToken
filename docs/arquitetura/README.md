# Arquitetura geral — CPR Digital

> **Documento de arquitetura.** Descreve o sistema inteiro: contexto,
> direcionadores, decomposição, dados, implantação, atributos de qualidade,
> riscos e evolução.
>
> **Autoridade:** `docs/BRIEFING.md` é a autoridade sobre *o que* o sistema
> deve ser. Este documento descreve *como* ele é construído para ser isso.
> Onde os dois divergirem, o briefing prevalece e este documento está errado.
>
> **Estado:** protótipo executável. O que está provado e o que não está vive em
> [`docs/ESTADO-DO-PROTOTIPO.md`](../ESTADO-DO-PROTOTIPO.md), e este documento
> não o contradiz em nenhum ponto.
>
> Última revisão: 2026-09-19.

---

## Índice

1. [Para que o sistema existe](#1-para-que-o-sistema-existe)
2. [Contexto](#2-contexto)
3. [Direcionadores arquiteturais](#3-direcionadores-arquiteturais)
4. [A ideia central: o token é representação](#4-a-ideia-central-o-token-é-representação)
5. [Decomposição em serviços](#5-decomposição-em-serviços)
6. [Arquitetura de dados](#6-arquitetura-de-dados)
7. [A fronteira on-chain / off-chain](#7-a-fronteira-on-chain--off-chain)
8. [Fluxos principais](#8-fluxos-principais)
9. [Preocupações transversais](#9-preocupações-transversais)
10. [Implantação](#10-implantação)
11. [Atributos de qualidade e como são verificados](#11-atributos-de-qualidade-e-como-são-verificados)
12. [Decisões estruturais registradas](#12-decisões-estruturais-registradas)
13. [Riscos arquiteturais e dívida conhecida](#13-riscos-arquiteturais-e-dívida-conhecida)
14. [Evolução: de protótipo a piloto](#14-evolução-de-protótipo-a-piloto)
15. [Mapa de leitura](#15-mapa-de-leitura)

---

## 1. Para que o sistema existe

O MVP não existe para "tokenizar CPR". Existe para **responder oito perguntas
que hoje não têm resposta empírica**, e cuja resposta determina se o produto
tem viabilidade. O briefing as chama de lacunas informacionais.

| | Lacuna | Estado |
|---|---|---|
| F1 | Custo de verificação por produtor | Parcial |
| F2 | Viabilidade técnica e jurídica do espelho | Parcial |
| F3 | Conciliação registro ↔ token | Resolvida **no simulador** |
| F4 | Custo e viabilidade do selo EUDR | Parcial |
| F5 | Pró-ciclicidade de receita e colateral | Resolvida |
| F6 | Executoriedade e calibração do fundo | Parcial |
| F7 | Disposição a pagar do lado credor | **Não resolvida** |
| F8 | Fechamento do ciclo contratual | Resolvida **no simulador** |

Isto tem consequência arquitetural direta e pouco usual: **a arquitetura é
otimizada para produzir evidência, não para escalar.** Daí decisões que
pareceriam excessivas num produto comum — instrumentação de custo em cada etapa
(`ops.custo_verificacao`), captura de latência de detecção em dois campos
distintos de timestamp, arquivamento do payload bruto de toda fonte externa,
trilha encadeada por hash.

Se uma funcionalidade não reduz custo de transação, de mensuração ou de
enforcement, e não fecha uma lacuna, ela é **rejeitada por padrão** — por
melhor que seja.

---

## 2. Contexto

```
                    ┌─────────────────────────────────────────────┐
                    │              CPR DIGITAL                    │
   produtor ───────▶│                                             │
                    │   originação · espelho · conciliação ·      │
   credor  ────────▶│   selo EUDR · waterfall · trilha            │
                    │                                             │
   auditor ────────▶│                                             │
                    └──┬────────┬─────────┬──────────┬────────────┘
                       │        │         │          │
                       ▼        ▼         ▼          ▼
              ┌─────────────┐ ┌──────┐ ┌───────┐ ┌──────────┐
              │ registradora│ │fontes│ │ bases │ │   KMS    │
              │  de títulos │ │preço,│ │ geo / │ │  (HSM)   │
              │             │ │pgto  │ │desmat.│ │          │
              └─────────────┘ └──────┘ └───────┘ └──────────┘
                  AUTORIDADE     P4        P4       chaves
                  (fonte de    quórum    quórum    de titular
                   verdade)
```

### Atores

| Ator | O que quer | O que a arquitetura lhe dá |
|---|---|---|
| **Produtor** | Antecipar receita da safra com o mínimo de atrito | Três decisões, sem jargão de sistema |
| **Credor** | Comprar risco com informação suficiente | Painel que mostra o problema primeiro |
| **Auditor / regulador** | Reconstruir o que se sabia, quando e com base em quê | Trilha encadeada e visão temporal |
| **Operador de conciliação** | Resolver divergência com responsabilidade registrada | Reconciliação humana identificada |
| **Operador de privacidade** | Executar direito do titular | Crypto-shredding com comprovante |

### Sistemas externos

| Sistema | Papel | Tratamento arquitetural |
|---|---|---|
| **Entidade registradora** | **Fonte de verdade** do título | Leitura com quórum; o sistema nunca escreve nela |
| **Fontes de preço e pagamento** | Insumo de decisão contratual | Quórum de fontes independentes (P4) |
| **Bases geoespaciais** | Referência de desmatamento | Quórum por interseção |
| **KMS / HSM** | Chaves por titular | A chave nunca entra no banco de PII |

**No protótipo**, a registradora é um simulador (`infra/simulador-registradora`)
e as fontes são sintéticas. As premissas embutidas nesse simulador estão
declaradas no [ADR-0006](../adr/0006-premissas-da-registradora.md), e são a
razão de F3 e F8 constarem como "resolvidas no simulador" e não como
"resolvidas".

---

## 3. Direcionadores arquiteturais

Os sete princípios da Seção 2 do briefing não são valores aspiracionais: são
**restrições de projeto**, cada uma com mecanismo de execução e teste que falha
quando a fronteira é cruzada.

| | Princípio | Mecanismo estrutural | Onde falha se violado |
|---|---|---|---|
| **P1** | O registro prevalece | Gatilho `tg_bloqueia_congelado`; nenhuma rota escreve no registro | `conformidade_ops.sql`, `validar:p7` |
| **P2** | Dado pessoal não toca a cadeia | Domínio `texto_sem_pii`; base separada; eventos sem `string` | `varrer-pii-cadeia`, invariante I7 |
| **P3** | Unicidade do colateral | `AncoraRegistro.vincular()` reverte; `UNIQUE (registro_hash_ancora)` | Invariantes I1, I1b, I2 |
| **P4** | Redundância de oráculo | `contarIndependentes()`; `tg_valida_uso_leitura` | `conformidade_ops.sql` |
| **P5** | Auditabilidade completa | Trilha encadeada; `exige_evidencia` no catálogo | `conformidade_audit.sql` |
| **P6** | Determinismo e reprodutibilidade | Forma canônica dupla; semente fixa; ABI congelada | `validar:eventos`, `validar:contratos` |
| **P7** | Fronteira regulatória codificada | Ausência de `payable`; varredura de código **e de texto** | `validar:p7`, `validar:abis` |

### O padrão que rege todos eles

**Preventivo antes de detectivo; estrutural antes de procedural.**

Para cada regra, a pergunta de projeto foi: *se alguém conectar no banco com
`psql`, ou chamar o contrato direto, a operação é recusada?* Onde a resposta
precisava ser "sim", a regra desceu para o DDL ou para o Solidity — porque
código de aplicação tem caminhos alternativos e prazo de validade, e um `CHECK`
não tem.

### De onde veio esse rigor

Do portão G1. Três revisores independentes — jurista regulatório, economista
institucional e um red team declarado — encontraram, em artefatos que os testes
da própria construção declaravam cobertos:

- um timelock de papéis sensíveis que **existia só no comentário NatSpec**;
- verificação de P7 que alcançava seis interfaces Solidity e **nenhum serviço**;
- uma saída de congelamento que aceitava uma **string** como prova de
  reconciliação.

O padrão comum: **a garantia estava no comentário, não no código.** As doze
solicitações de mudança de contrato (`docs/contracts/MUDANCAS.md`) são, na
maioria, a correção desse padrão.

---

## 4. A ideia central: o token é representação

Se houver uma única coisa a entender desta arquitetura, é esta.

```
   ┌───────────────────────┐              ┌───────────────────────┐
   │  ENTIDADE             │              │   CADEIA              │
   │  REGISTRADORA         │              │   (espelho)           │
   │                       │              │                       │
   │  ◄── fonte de verdade │              │   representação ──►   │
   └───────────┬───────────┘              └───────────┬───────────┘
               │                                      │
               │        ┌──────────────────┐          │
               └───────▶│   CONCILIAÇÃO    │◀─────────┘
                        │  (dois sentidos) │
                        └────────┬─────────┘
                                 │  divergência
                                 ▼
                        ┌──────────────────┐
                        │   CONGELAMENTO   │
                        │  + reconciliação │
                        │      HUMANA      │
                        └──────────────────┘
```

Três consequências que atravessam todo o código:

**1. Não existe função que altere o registro.** Nem no contrato, nem no
serviço, nem na API. A ausência é parte do desenho, verificada por
`validar:p7`, que procura identificadores como `escreverNoRegistro` e
`corrigirRegistro`.

Esta ausência foi testada na prática. `OriginacaoService.registrar()`
originalmente escrevia no simulador de registradora para depois ler de volta —
o núcleo fabricava a verdade que depois tratava como fonte. Ninguém notou na
revisão de código; a autorização por escopo notou, porque o token de serviço
não tem `simulador:operar`. Hoje o método lê e confere.

**2. Divergência congela, não corrige.** Quando registro e cadeia discordam, o
sistema não escolhe um lado nem "sincroniza": suspende operações e exige
decisão humana identificada, com justificativa e chave estrangeira para a
divergência efetivamente reconciliada.

**3. Congelar é poder, e poder limitado precisa de desenho.** Um sistema que
congela o ativo de terceiro tem controle sobre ele — o que tensiona P7 (não
interposição, não custódia). O [ADR-0007](../adr/0007-tensao-p1-p7.md) resolve
**limitando o poder, não negando-o**: quem congela não descongela, só o papel
humano de reconciliação descongela, papéis sensíveis passam por timelock, e a
pausa global não altera estado nem lógica.

---

## 5. Decomposição em serviços

### O critério: quem pode ver o quê

A fronteira **não** foi traçada por camada técnica nem por tamanho. Foi traçada
por acesso a dado.

| Serviço | Vê | Nunca vê | Por que é separado |
|---|---|---|---|
| `core` | Domínio, cadeia | PII, geometria bruta | É onde P1 pode ser auditado num lugar só |
| `oracle` | Fontes externas | PII, domínio | Quórum é decisão, não utilitário |
| `eudr` | **Geometria bruta** | PII, cadeia | Geometria é pesada e reidentificante |
| `compliance` | **PII** | Cadeia, geometria | Dado pessoal precisa de uma porta só |

O ponto que torna isso verificável: **`core` não possui credencial de
`cpr_pii`.** Não é que ele não deva acessar o cofre — ele não consegue. No
ambiente em contêineres a separação vai adiante e vira topologia: `core` nunca
está na rede `cofre`.

Uma divisão por camada ("api", "workers", "jobs") teria os quatro acessos em
todos os processos, e a separação seria convenção.

### Visão de contêineres

```
                      ┌──────────────┐
   navegador ────────▶│  apps/web    │  Next.js, renderização no servidor
                      └──────┬───────┘  token de escopo de leitura, 5 escopos
        ┌────────────────────┼─────────────────────┬──────────────────┐
        ▼                    ▼                     ▼                  ▼
┌───────────────┐   ┌────────────────┐   ┌─────────────────┐  ┌──────────────┐
│ services/core │──▶│ services/oracle│◀──│  services/eudr  │  │  compliance  │
│ :3003         │   │ :3002          │   │ :3004           │  │ :3001        │
│ domínio,      │   │ quórum,        │   │ polígono, selo, │  │ cofre de PII,│
│ conciliação,  │   │ disputa,       │   │ DDS             │  │ KYC, LGPD    │
│ waterfall     │   │ linhagem       │   │                 │  │              │
└───────┬───────┘   └────────┬───────┘   └────────┬────────┘  └──────┬───────┘
        │                    │                    │                  │
        │            ┌───────▼────────┐           │                  │
        │            │  registradora  │           │                  │
        │            │  :3005 (sim.)  │           │                  │
        │            └────────────────┘           │                  │
        ▼                                         ▼                  ▼
  ┌──────────┐                              ┌──────────┐      ┌───────────┐
  │  cadeia  │                              │ cpr_ops  │      │  cpr_pii  │
  │  (EVM)   │                              │ ops·geo· │      │           │
  └──────────┘                              │   sim    │      └───────────┘
                                            └────┬─────┘
                                                 │
                                           ┌─────▼──────┐
                                           │ cpr_audit  │
                                           └────────────┘
```

### O que atravessa cada fronteira

Esta tabela é o contrato de acoplamento do sistema:

| De | Para | O que passa | O que **não** passa |
|---|---|---|---|
| `compliance` | qualquer | Atestação ("KYC aprovado, válido até") | Nome, documento, dossiê |
| `eudr` | `core` | Resultado do selo e hash da evidência | Polígono bruto |
| `oracle` | `core`, `eudr` | Valor com quórum e linhagem | Leitura sem quórum |
| `core` | cadeia | Hash, referência opaca, valor | Qualquer texto livre |
| registradora | `core` | Estado do título | — (leitura apenas) |

### Comunicação

HTTP/JSON síncrono, com OpenAPI 3.1 congelado em `docs/contracts/openapi/`.

**Cada serviço se identifica com token próprio de perfil `servico`, nunca com o
token do usuário que originou a requisição.** Repassar o token do usuário é o
padrão comum em microsserviços e é uma armadilha: o serviço passa a agir com a
autoridade de quem chamou, e um credor consegue por via indireta o que o escopo
dele recusa na porta da frente. [#REF]

O custo é que o serviço chamado não sabe qual humano originou a cadeia. Por
isso identidade-para-autorização e identidade-para-auditoria viajam separadas:
`x-correlacao-id` atravessa as chamadas, e a trilha guarda o ator do fato
original.

**Não há barramento de mensagens.** Eventos são gravados em `ops.evento` na
mesma transação do fato (padrão *outbox*). Para o volume do protótipo isso
basta, e evita uma peça de infraestrutura cuja falha seria difícil de
diagnosticar. Em escala, o outbox é o ponto natural de onde um barramento
passaria a consumir — sem mudar quem produz.

---

## 6. Arquitetura de dados

### Três bases, não três schemas

| Base | Conteúdo | Credencial | Papéis |
|---|---|---|---|
| `cpr_ops` | Domínio operacional, **sem PII** | `OPS_URL` | `cpr_app`, `cpr_geo`, `cpr_ro`, `cpr_sim` |
| `cpr_pii` | Cofre, tudo cifrado | `PII_URL` | separados |
| `cpr_audit` | Trilha encadeada, append-only | `AUDIT_URL` | `cpr_audit_writer`, `cpr_audit_reader` |

PostgreSQL 16 + PostGIS. Três instâncias separadas, três credenciais distintas
([ADR-0002](../adr/0002-privacidade-onchain-offchain.md)).

**Um `JOIN` entre operação e PII é sintaticamente inalcançável** a partir de
qualquer conexão. O vínculo existe como ponteiro sem chave estrangeira
(`pii.titular.ops_produtor_id`), e a integridade referencial perdida é o preço
consciente da separação ganha.

`packages/nucleo/src/config.ts` fecha o cerco: se duas credenciais apontarem
para o mesmo `host` + `pathname`, o processo não sobe.

### Dentro de `cpr_ops`

```
ops   — domínio operacional (37 tabelas e visões)
geo   — geometrias BRUTAS; REVOKE ALL para cpr_ro e cpr_app (3 tabelas)
sim   — simulador de registradora; NUNCA promovido a produção (2 tabelas)
```

Coordenada de propriedade rural identifica o titular com precisão maior que o
endereço. O painel de auditoria vê o centroide ofuscado (≥ 5 km), nunca a
geometria.

### O cofre e o crypto-shredding

Nenhuma coluna identificante em texto claro — todas terminam em `_cif`.
AES-256-GCM, **uma chave por titular**, guardada no KMS; o banco tem só a
referência.

Eliminar o titular é **destruir a chave**: o texto cifrado remanescente vira
ruído. Isso resolve a tensão entre o direito à eliminação da LGPD e a
imutabilidade da trilha — o registro permanece (a trilha não pode ter buracos)
e o conteúdo identificável torna-se irrecuperável. [#REF]

Busca sem decifrar por índice cego: HMAC-SHA256 com chave de serviço, não hash
simples — hash de CPF é reversível por dicionário em minutos.

### A trilha de auditoria

```
hash = sha256(hash_anterior ‖ id ‖ tipo ‖ sujeito ‖ ocorrido_em ‖ canonical(payload))
```

**O encadeamento é feito pelo gatilho do banco, não pelo escritor.** Um escritor
que calculasse o próprio hash poderia forjá-lo; assim, ele entrega o fato e não
controla o elo. Três gatilhos recusam `UPDATE`, `DELETE` e `TRUNCATE`, somados a
`REVOKE` — cinto e suspensórios, porque o `REVOKE` pode ser desfeito por um
superusuário distraído.

### Máquina de estados como dado

Nove estados, catorze transições, guardadas em `ops.transicao_permitida` —
**linha de tabela, não `switch` em TypeScript**. A mesma tabela alimenta o
domínio e a base, e o CI compara as duas cópias.

```
RASCUNHO → EM_VERIFICACAO → REGISTRADO → ESPELHADO → ATIVO
                                                       ├→ EM_DISPUTA ⇄ ATIVO
                                                       ├→ INADIMPLENTE
                                                       └→ LIQUIDADO
                                          EM_DISPUTA / INADIMPLENTE → EXECUTADO
```

---

## 7. A fronteira on-chain / off-chain

### O critério de admissão à cadeia

Não é "como tokenizar", é **"o que precisa estar on-chain para que algo fique
estruturalmente impossível?"** Tudo que não responde a isso é melhor servido por
um banco.

| On-chain | Por quê |
|---|---|
| Âncora registro ↔ token | Unicidade do colateral tem de ser impossível, não vigiada |
| Estado do espelho | Congelamento tem de valer contra todos, inclusive contra quem opera |
| Registro de habilitados | Circulação fechada tem de ser verificável pela contraparte |
| Vínculos de garantia | Ordem de preferência tem de ser oponível |

**Off-chain, sem exceção:** nome, CPF, polígono, documento, valor em reais de
pessoa identificada.

### Os cinco contratos

```
ControleAcesso ──────► 7 papéis, timelock nos 4 sensíveis
      ▲
      ├── RegistroParticipantes ──► quem pode receber espelho
      ├── AncoraRegistro ─────────► IMUTÁVEL, sem proxy
      ├── EspelhoCPR ─────────────► ERC-3525, UUPS + timelock
      └── CofreGarantias ─────────► vínculos e waterfall, SEM custódia
```

### A assimetria mais importante do desenho

**O espelho é atualizável; a âncora, não.**

Se a âncora vivesse atrás de um proxy, quem controla o proxy poderia desfazer a
unicidade do colateral, e P3 passaria de propriedade estrutural a promessa de
governança. Garantia que depende de upgrade não é garantia estrutural
([ADR-0004](../adr/0004-upgradeability-contratos.md)).

O preço é real: defeito na âncora não tem conserto por upgrade, exige migração
completa. Foi aceito conscientemente, e é a razão de a âncora ser o contrato
mais simples dos cinco — 56 linhas. Superfície pequena porque não há segunda
chance.

### ERC-3525

A CPR precisa de duas propriedades que nem ERC-20 nem ERC-721 dão juntas:
**identidade** (cada CPR é única, com registro e vencimento próprios) e
**fracionabilidade** (o credor cede parte do crédito). No ERC-3525 o `slot`
agrupa e o `value` fraciona. [#REF]

### P7 como ausência verificável

`CofreGarantias` **não tem** função `payable`, `receive` nem `fallback`. Custodiar
ativo virtual de terceiro cruzaria a fronteira regulatória; o contrato registra
vínculos, e a custódia acontece fora, nos instrumentos jurídicos de garantia.

A ausência é verificada em CI sobre a ABI — porque G1 ensinou que promessa em
comentário não é garantia.

---

## 8. Fluxos principais

### Ciclo de vida de uma CPR

| # | Etapa | Serviço | O que garante |
|---|---|---|---|
| 1 | Onboarding | `compliance` | PII entra pela única porta, cifrada; sai referência opaca |
| 2 | Habilitação | `compliance` → cadeia | Endereço habilitado com hash de atestação e validade |
| 3 | Polígono e selo | `eudr` | Geometria validada pelo PostGIS, cruzada com duas bases |
| 4 | Originação | `core` | Rascunho por referência opaca; nenhum dado pessoal atravessa |
| 5 | Registro | emitente → registradora; `core` **confere** | P1: o núcleo lê e confirma, não escreve |
| 6 | Espelhamento | `core` → cadeia | Emissão idempotente por âncora; a segunda reverte **no contrato** |
| 7 | Conciliação contínua | `core`, agendada | Compara nos dois sentidos, classifica, congela |
| 8 | Marcação a mercado | `core` + `oracle` | Preço com quórum; LTV inclusive acima de 100% |
| 9 | Liquidação | `core` + `oracle` | Pagamento por unanimidade de duas fontes e baixa registrada |

### Conciliação — o fluxo que define o sistema

```
       ┌─────────────┐  quórum  ┌──────────┐
       │ registradora│◀─────────│  oracle  │
       └─────────────┘          └────┬─────┘
                                     │  estado registral
                                     ▼
   cadeia ──eventos──────────▶  ┌──────────┐
                                │   core   │  compara nos DOIS sentidos
                                └────┬─────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
        sem quórum             sem divergência          divergência
              │                      │                      │
     sinaliza a ausência      marca CONCILIADO       ① transição EM_DISPUTA
     (P4) — não conclui       com transição          ② congela
     "está tudo certo"        registrada             ③ evento + incidente
```

Três detalhes com consequência:

**A leitura do registro passa pelo oráculo**, não por chamada direta. O estado
registral é leitura crítica, e leitura crítica exige quórum — sem isso, uma
registradora com bug decidiria sozinha o que o sistema trata como verdade.

**Sem quórum não se conclui nada.** O caminho fácil seria tratar falha de
leitura como "nenhuma divergência encontrada": o placar ficaria verde, e o
verde significaria cegueira.

**A ordem ① antes de ② custou um bug.** O gatilho `tg_bloqueia_congelado`,
escrito para impedir manipulação, bloqueava a própria transição que registra a
entrada em disputa. A correção foi inverter a ordem no serviço, **não**
afrouxar o gatilho.

### Os dois sentidos

O catálogo original de divergências só enxergava registro → token. Em G1, o
jurista apontou que a fração pode circular on-chain sem cessão registrada e a
conciliação seria cega. SMC-004 acrescentou o evento on-chain
`TitularidadeAlterada` e dois tipos: `TRANSFERENCIA_SEM_CESSAO` e
`FRACIONAMENTO_NAO_REFLETIDO`.

Hoje são **14 tipos**, com latência medida separadamente por sentido:
~125 ms pelo lado do registro, ~4,3 s pelo lado da cadeia — varrer eventos custa
mais que comparar campos.

---

## 9. Preocupações transversais

### Autorização: recusa por omissão

**Rota sem `@Escopos` e sem `@Publica` responde 403**, não 200. Toda API que
acaba aberta seguiu o caminho oposto: o padrão era liberar, alguém esqueceu de
anotar, e nada falhou.

22 escopos granulares por ação, 7 perfis. Duas separações que importam:

- `conciliacao:executar` ≠ `conciliacao:reconciliar` — disparar um ciclo é uma
  coisa; decidir que uma divergência está resolvida é outra.
- `geo:avaliar` ≠ `geo:bruto` — avaliar conformidade não exige ver o polígono.

**O perfil `servico` tem 17 escopos, e nenhum é `conciliacao:reconciliar`,
`oraculo:disputar` ou `simulador:operar`.** As três ações que exigem decisão
humana estão fora do alcance de qualquer processo automático — é aqui que "não
existe reconciliação automática" deixa de ser afirmação e vira propriedade.

### Auditabilidade

Todo evento passa por `publicar()`, que recusa três coisas antes de escrever:
tipo fora do catálogo congelado, evidência ausente em evento que a exige, e
sujeito incompatível. Dezenove dos 23 tipos exigem evidência.

O envelope separa `ocorrido_em` de `registrado_em`, e a diferença entre os dois
é a latência de detecção — métrica, não detalhe. `causa_id` permite reconstruir
a cadeia **causal**, não apenas a cronológica.

### Observabilidade

Log estruturado JSON com `correlacao_id` obrigatório. `higienizar()` substitui
CPF, CNPJ e e-mail recursivamente antes de escrever — log é o vetor de vazamento
mais comum e o menos vigiado, porque ninguém revisa linha de log em code review.

Três tarefas agendadas com trava consultiva PostgreSQL para eleição de líder
(`pg_try_advisory_lock`), que some sozinha se o processo morrer. A sentinela
alerta sobre divergência fora do prazo e — mais importante — sobre **silêncio da
conciliação**: para quem olha de fora, ausência de divergência e ausência de
conciliação são a mesma coisa.

### Tratamento de erro

RFC 9457 com um campo a mais: `principio_violado`. [#REF] Quem consome a API
descobre **por que** a recusa aconteceu, não só que aconteceu.

### Instrumentação de custo

`comCusto()` cronometra cada etapa e grava em `ops.custo_verificacao`,
**inclusive quando falha** — tentativa fracassada custa, e o custo de falhar é
metade da resposta sobre viabilidade.

Existe por observação de G1: seis das oito lacunas são de custo, e nada media
custo. O dossiê de G4 teria de narrar o que deveria demonstrar (SMC-007).

---

## 10. Implantação

### Desenvolvimento

`node infra/orquestrar.mjs subir` — banco, nó EVM e seis processos, com pidfile
e a porta como fonte de verdade sobre o que está no ar.

### Ambiente de teste (composição)

```
redes:  dados ─── bd-ops, bd-audit, core, eudr, registradora, migracao
        cofre ─── bd-pii, compliance, migracao          ← só isto alcança o cofre
        servicos ─ todos os serviços + web
        cadeia ─── besu-1..4, core
```

**Quatro redes em vez de uma: a topologia é parte do controle de acesso.** `web`
não alcança banco nenhum; `eudr` não alcança a cadeia; `core` nunca esteve na
rede `cofre` — a impossibilidade de tocar PII é topológica, não só de
credencial.

Segredos sem padrão silencioso: a sintaxe `${VAR:?}` faz o compose **recusar
subir** sem `CPR_SEGREDO_JWT` e sem `CORS_ORIGENS`.

Imagens multi-estágio, base fixada em versão exata (`node:22.22-bookworm-slim`,
não `22` nem `latest`), `USER node`, `--ignore-scripts`, healthcheck em `/saude`
— a única rota pública, para que o orquestrador não precise de credencial.

### Migrações

Forward-only, com checksum por migração. Migração já aplicada que muda de
conteúdo **interrompe tudo** — editar migração aplicada é como dois ambientes
divergem sem ninguém perceber.

**Credencial de migração distinta da de execução**: a aplicação conecta com um
papel que não pode `CREATE`, `DROP` nem `ALTER`. Um SQL injection bem-sucedido
na aplicação não apaga `audit.registro`, porque o papel não tem o direito.

### ⚠️ A composição nunca foi executada

Não há daemon Docker no ambiente em que foi escrita. O aviso está no topo do
próprio arquivo, e `validar:compose` verifica o que se pode verificar sem
executar — sintaxe, referências, variáveis, topologia — sem fingir que
substitui a execução.

A rede Besu com QBFT ([ADR-0001](../adr/0001-rede-distribuida.md)) também nunca
subiu. O que está provado sobre os contratos foi provado em nó Hardhat local.

---

## 11. Atributos de qualidade e como são verificados

### O que foi demonstrado provocando a falha

| Propriedade | Como foi verificada | Resultado |
|---|---|---|
| Detecção de divergência | 14 tipos injetados no simulador | 13 detectados; 1 **nomeado** como não detectado |
| Latência | Medida por tipo e por sentido | 85–130 ms / ~4,3 s |
| Invariantes dos contratos | 61 testes, `solidity-coverage` | 100% linhas e funções, 90% ramos |
| Autorização | 21 casos | 21/21 |
| Ponta a ponta | 20 passos | saída 0 |
| PII na cadeia | Varredura de calldata, logs e tópicos | nenhum achado; **detector autotestado** |
| Crypto-shredding | Destruir a chave e **tentar decifrar** | `FALHOU_COMO_ESPERADO` |
| Deriva de migração | **Alterar** uma migração aplicada | parou com diagnóstico correto |
| Trava de agenda | Trava segurada por `psql` externo | core cedeu 3 vezes |

As quatro últimas valem mais que as demais, porque foram verificadas
**provocando a condição de falha**. Um teste de crypto-shredding que só verifica
se `eliminado_em` foi preenchido não distingue eliminação de fingimento.

### O princípio do autoteste

```js
// Um varredor quebrado passa silenciosamente e dá garantia falsa — que é pior
// que garantia nenhuma, como o painel apontou em G1.
```

A varredura de PII injeta quatro payloads com dado identificável e **falha se o
detector não os acusar**, antes de varrer a cadeia. Sem isso, uma expressão
regular quebrada num refactor passaria a aceitar tudo, o CI continuaria verde, e
a equipe ficaria mais confiante enquanto a proteção desapareceu.

**Garantia falsa é pior que garantia nenhuma**, porque remove a vigilância que
existiria sem ela.

### Escala e desempenho

Não foram testados, e a arquitetura não foi otimizada para eles. Pontos onde a
escala morderia primeiro, em ordem:

1. `audit.verifica_cadeia()` é **O(n)** — recomputa a cadeia inteira. O
   parâmetro `p_desde` existe para checkpoint incremental, e é o único preparo
   feito.
2. A conciliação varre **todos** os contratos espelhados a cada ciclo, sem
   particionamento nem paralelismo.
3. `queryFilter` sobre eventos varre desde o bloco 0.
4. A agenda é de líder único: uma réplica faz todo o trabalho.

Nenhum é difícil de resolver; nenhum foi resolvido, porque a pergunta do MVP
não é de escala.

---

## 12. Decisões estruturais registradas

### ADRs

| ADR | Decisão | Estado |
|---|---|---|
| [0001](../adr/0001-rede-distribuida.md) | Besu com QBFT para a rede permissionada | Proposto — pendente de G1 |
| [0002](../adr/0002-privacidade-onchain-offchain.md) | Dado pessoal fora da cadeia **por exclusão**, não por criptografia | Proposto — pendente de G1 |
| [0003](../adr/0003-politica-quorum-oraculos.md) | Quórum de fontes independentes por tipo, com degradação explícita | Proposto — pendente de G1 |
| [0004](../adr/0004-upgradeability-contratos.md) | UUPS com timelock, e âncora **imutável** | Proposto — pendente de G1 |
| [0005](../adr/0005-perimetro-regulatorio.md) | Perímetro por **restrição estrutural**, não por qualificação do produto | Decorrente de G1 |
| [0006](../adr/0006-premissas-da-registradora.md) | Declarar as premissas embutidas no simulador | Decorrente de G1 |
| [0007](../adr/0007-tensao-p1-p7.md) | Resolver P1 × P7 **limitando o poder**, não negando-o | Decorrente de G1 |
| [0008](../adr/0008-desvios-de-ambiente-do-prototipo.md) | Registrar os desvios de stack antes de usá-los | Aceito |

A escolha de criptografia no ADR-0002 merece destaque. Cifrar PII e pôr na
cadeia seria mais simples de implementar e é a escolha comum. Foi recusada
porque **criptografia envelhece e o livro é imutável**: o que hoje é ilegível
pode não ser em vinte anos, e não há como recolher. A exclusão não envelhece.

### As doze solicitações de mudança de contrato

Em `docs/contracts/MUDANCAS.md`. Cada uma nomeia o defeito que a originou:

| | | Origem |
|---|---|---|
| SMC-001 | Saída do congelamento deixa de ser uma string | Red team, G1 |
| SMC-002 | Quórum exigido também no ramo degradado | G1 |
| SMC-003 | Verificação de P7 alcança o código-fonte | E1 + red team, G1 |
| SMC-004 | Catálogo enxerga o sentido token → registro | E1, G1 |
| SMC-005 | Timelock ganha proposta | Red team, G1 |
| SMC-006 | Garantia real ganha oponibilidade | Modelagem de risco |
| SMC-007 | Instrumentação de custo | E6, G1 |
| SMC-008 | ADRs ausentes | G1 |
| SMC-009 | Geometria das bases de desmatamento no banco | Construção |
| SMC-010 | Resolução espacial como coluna da base | Construção |
| SMC-011 | LTV deixa de ser limitado a 100% | Cenário de estresse |
| SMC-012 | Credencial de base exigida por quem a usa | Construção |

O SMC-011 é instrutivo além do seu escopo: o domínio `ops.pct` limitava LTV a
100%, tornando a **subcolateralização inexprimível** — exatamente o estado que
importava medir. Restrição de domínio protege contra dado inválido e, no mesmo
gesto, pode proibir a realidade. A pergunta certa não é "qual a faixa normal?",
é "qual a faixa em que ainda preciso enxergar o que está acontecendo?".

### Governança dos contratos congelados

`docs/contracts/` e `contracts/interfaces/` são congelados. Os tipos TypeScript
e o catálogo de eventos são **gerados** a partir deles, e o CI reprova
divergência. Mudar exige SMC com motivo, impacto por agente e proposta de versão.

Isso existe porque o repositório foi construído por sete agentes com diretórios
exclusivos: sem o regime de congelamento, cada mudança de interface quebraria os
outros seis sem aviso.

---

## 13. Riscos arquiteturais e dívida conhecida

### Riscos de arquitetura

| Risco | Impacto | Mitigação atual | O que falta |
|---|---|---|---|
| **Registradora real difere do simulador** | Alto — F3 e F8 voltam a abrir | Premissas declaradas no ADR-0006 | Integração real |
| **Âncora imutável com defeito** | Alto — exige migração completa | Contrato de 56 linhas, cobertura total | Auditoria externa (G2) |
| **Segredo JWT simétrico compartilhado** | Alto — comprometer um serviço forja qualquer perfil | Ponto único de substituição marcado | Emissor com JWKS |
| **Trilha de auditoria sem backup** | Alto — trilha perdida não se reconstrói | Nenhuma | Backup e retenção |
| **Verificação de cadeia O(n)** | Médio — degrada com volume | `p_desde` disponível | Checkpoint periódico |
| **Sem revogação de token** | Médio — token vazado vale até expirar | TTL curto (15 min para serviço) | Lista de revogação |
| **Agenda de líder único** | Baixo — não escala horizontalmente | Trava por tarefa, não por processo | Particionamento |

### Dívida deliberada, com motivo

| Dívida | Por que foi aceita |
|---|---|
| JWT HS256 escrito à mão | 30 linhas auditáveis vs. cadeia de dependências não auditada; prazo de validade nomeado no comentário |
| KMS local em arquivo | A propriedade que importa (chave fora da base) é real; troca por KMS gerenciado não muda o desenho |
| Chaves determinísticas do Hardhat | Registrado no ADR-0008; produção exige HSM |
| Sem barramento de mensagens | Outbox basta no volume atual e é o ponto natural de evolução |
| Sem framework de CSS | Seis páginas densas e pouca interação |

### O que simplesmente não existe

Observabilidade além de log (sem métricas, tracing ou alerta — a sentinela
escreve em log de erro e ninguém é acordado); backup e plano de recuperação;
gestão de segredos com cofre e rotação; identidade de usuário final; teste de
carga, de concorrência real e de recuperação de falha; auditoria de
acessibilidade.

### Os portões não executados

**G2** (segurança, dados e privacidade) e **G3** (prontidão de demonstração)
nunca rodaram. Os pareceres que E2, E3 e E5 dariam sobre o código construído não
existem — e a experiência de G1 diz o que esperar: revisores independentes
encontram, em artefatos que os testes declaram cobertos, garantias que moram no
comentário.

---

## 14. Evolução: de protótipo a piloto

### O que muda por substituição (desenho preservado)

| Hoje | Piloto | Ponto de troca |
|---|---|---|
| Simulador de registradora | Registradora real | Adaptador de fonte `REGISTRO` no `oracle` |
| `KmsLocal` em arquivo | KMS gerenciado / HSM | Interface de `kms.ts` |
| JWT HS256 com segredo compartilhado | Emissor externo com JWKS | `verificarToken()` |
| Nó Hardhat | Besu QBFT, 4 validadores | `RPC_URL` e implantação |
| Bases geo sintéticas | Bases reais de desmatamento | `ops.base_referencia_geo` |
| Chaves determinísticas | HSM por papel | `cadeia.ts` |

Que essa lista seja de substituições e não de reescritas é o teste da
arquitetura: cada peça provisória está atrás de uma fronteira nomeada.

### O que exige construção nova

Observabilidade (métricas, tracing, alerta com destinatário); backup e
recuperação, com atenção especial à trilha; gestão de segredos; identidade de
usuário final; checkpoint para verificação incremental da cadeia.

### O que nenhum código resolve

**F7 — disposição do credor a pagar pela verificação.** Há instrumento
(`ops.reacao_credor`) e painel; não há credor real reagindo. Esta lacuna exige
campo, não engenharia, e apresentá-la como resolvida seria a desonestidade mais
cara deste projeto.

E **F2 na sua metade jurídica**: E1 reprovou em G1 e não houve nova rodada de
parecer sobre o sistema construído.

---

## 15. Mapa de leitura

| Quero | Leia |
|---|---|
| Por que o sistema existe | [`docs/BRIEFING.md`](../BRIEFING.md) |
| **Como ele é feito, em geral** | **este documento** |
| Como ele é feito, aspecto por aspecto | [`docs/codigo/`](../codigo/README.md) — 11 documentos |
| Por que uma decisão foi tomada | [`docs/adr/`](../adr/) — 8 ADRs |
| O que mudou num contrato congelado, e por quê | [`docs/contracts/MUDANCAS.md`](../contracts/MUDANCAS.md) — 12 SMCs |
| O que o painel disse | [`docs/panel/`](../panel/) |
| **O que está provado e o que não está** | [`docs/ESTADO-DO-PROTOTIPO.md`](../ESTADO-DO-PROTOTIPO.md) |
| Consumir uma API | [`docs/contracts/openapi/`](../contracts/openapi/README.md) |
| O modelo de dados congelado | [`docs/contracts/db/`](../contracts/db/README.md) |

---

## Nota sobre este documento

Ele descreve a arquitetura **como ela está**, incluindo o que não funciona, o
que nunca foi executado e o que foi corrigido depois de quebrar. A alternativa —
descrever a arquitetura pretendida — produziria um documento mais limpo e menos
útil, do mesmo tipo dos comentários NatSpec que prometiam um timelock que não
existia.

Quando este documento e o código divergirem, **o código está certo e este
documento está desatualizado**. Corrija-o.
