# 9. Operação — subir, migrar, agendar, conteinerizar

> `infra/` — orquestrador, migrações, contêineres, composição, massa sintética
> e roteiros de demonstração.

## 9.1 Desenvolvimento: `infra/orquestrar.mjs`

```bash
node infra/orquestrar.mjs subir     # banco, nó EVM e seis processos
node infra/orquestrar.mjs estado    # o que está de pé
node infra/orquestrar.mjs descer    # derruba tudo pelo pidfile
```

| Processo | Porta |
|---|---|
| `registradora` (simulador) | 3005 |
| `compliance` | 3001 |
| `oracle` | 3002 |
| `eudr` | 3004 |
| `core` | 3003 |
| `web` | 3000 |

A ordem de subida importa: o core depende do oráculo, que depende da
registradora.

### Por que existe, e o que ele evita

```js
// Usa pidfile em vez de pkill por padrão: `pkill -f` casa com a própria linha
// de comando de quem chama e derruba o chamador junto — erro barato de cometer
// e caro de depurar.
```

Isto é registro de um erro real. Um `pkill -f "services/oracle/dist"` matou o
próprio shell que o executou (saída 144), porque o padrão casou com a linha de
comando do processo chamador. O orquestrador nasceu daí.

### A porta como fonte de verdade

```js
// npx e next start criam processos filhos: o pid do lançador pode morrer com o
// serviço de pé, e o pidfile passa a mentir. A porta é a fonte de verdade sobre
// o que está no ar.
```

`estado` verifica pid **e** porta. Um pidfile órfão apontando para pid morto
enquanto o serviço continua respondendo é o caso que produz "derrubei tudo" e
duas instâncias rodando.

---

## 9.2 Migrações: `infra/db/migrar.mjs`

```bash
node infra/db/migrar.mjs            # aplica o que falta
node infra/db/migrar.mjs --estado   # mostra o que está aplicado
node infra/db/migrar.mjs --seco     # diz o que faria, sem escrever
```

```js
// Substitui o CPR_RECRIAR=1, que dropava as três bases. Em desenvolvimento
// aquilo era honesto; em ambiente de teste com dados, é perda de dado.
```

Três garantias, cada uma contra um modo de falha conhecido:

**1. Checksum.** SHA-256 (16 caracteres) de cada migração, guardado em
`public.migracao`. Migração já aplicada que muda de conteúdo **interrompe
tudo**.

```sql
COMMENT ON TABLE public.migracao IS
  'O checksum existe para detectar edição de migração já aplicada — a forma
   silenciosa de dois ambientes divergirem.';
```

Editar uma migração aplicada é como dois ambientes divergem sem ninguém
perceber: o de produção tem o DDL antigo, o novo tem o corrigido, e os dois
dizem que a migração `030` está aplicada.

**Verificado empiricamente:** alterei uma migração já aplicada e o migrador
parou com o diagnóstico correto, nomeando o arquivo.

**2. Ordem estável.** Numeração explícita, ordem lexicográfica.

**3. Transação por migração.** *"Ou entra inteira, ou não entra"* — nada de
meia-tabela.

### As duas credenciais

```js
// Credencial de migração é distinta da credencial de execução, e isso não é
// zelo: migrar com o usuário da aplicação significa que a aplicação pode
// alterar o esquema em tempo de execução — privilégio que ela não deveria ter,
// e que um comprometimento aproveitaria imediatamente.
```

`OPS_URL_MIGRACAO` ≠ `OPS_URL`, e assim para as três bases. A aplicação conecta
com um papel que **não pode** `CREATE TABLE`, `DROP` nem `ALTER`. Um SQL injection
bem-sucedido na aplicação não consegue apagar `audit.registro` — não porque a
aplicação não o faria, mas porque o papel não tem o direito.

### Forward-only

Não há `down`. Rollback de migração em base com dados é ilusão confortável: a
migração de volta quase nunca restaura o que a de ida destruiu. A correção é
uma migração nova, para a frente, que fica no histórico.

O baseline é `docs/contracts/db/` (congelado), e as migrações incrementais vão
em `infra/db/migracoes/{ops,pii,audit}/`.

---

## 9.3 Contêineres: `infra/docker/`

Três Dockerfiles: `Dockerfile.servico`, `Dockerfile.web`, `Dockerfile.migracao`.

### Um Dockerfile para cinco serviços

```dockerfile
# ARG SERVICO define qual workspace é construído — um Dockerfile para os cinco,
# porque cinco arquivos quase idênticos divergem em três semanas.
```

Cinco arquivos quase idênticos parecem mais claros e envelhecem mal: alguém
corrige um, esquece os outros quatro, e a diferença só aparece em produção.

### Multi-estágio

```dockerfile
FROM node:22.22-bookworm-slim AS construcao   # tem TypeScript
FROM node:22.22-bookworm-slim AS execucao     # não tem
```

A imagem final não carrega compilador nem ferramental de build — menos
superfície e menos peso. Base fixada em versão exata (`22.22-bookworm-slim`),
não em `22` ou `latest`: reprodutibilidade (P6) não sobrevive a tag móvel.

### Ordem das camadas

```dockerfile
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/nucleo/package.json …
RUN npm ci --ignore-scripts
COPY packages ./packages          # só depois
```

Lockfile antes do código: a camada de dependências só é refeita quando as
dependências mudam. `--ignore-scripts` porque script de pós-instalação é vetor
conhecido de cadeia de suprimentos.

### Usuário e healthcheck

```dockerfile
USER node          # processo sem privilégio
HEALTHCHECK … CMD node -e "fetch('…/saude')…"
```

```dockerfile
# O healthcheck bate em /saude, a única rota pública — de propósito, para que
# o orquestrador não precise de credencial para saber se o processo vive.
```

É o motivo de `/saude` devolver só o veredito: o orquestrador precisa de um
sinal sem credencial, e detalhe operacional público é vazamento de topologia. O
detalhe vive em `/diagnostico`, com escopo (`06-servicos.md` §6.6).

---

## 9.4 Composição: `infra/compose/docker-compose.yml`

```yaml
# AVISO DE HONESTIDADE: este arquivo NÃO foi executado. O ambiente em que foi
# escrito não tem daemon Docker. A estrutura segue o que o briefing pede e o
# que os serviços consomem hoje, mas a primeira execução vai encontrar erro —
# trate como ponto de partida verificável, não como configuração validada.
```

O aviso está no topo do arquivo, não numa nota de rodapé. Apresentar
configuração não executada como pronta é o tipo de afirmação que custa um dia de
depuração a quem confiar nela.

`infra/ci/validar-compose.mjs` verifica o que se pode verificar sem executar:
sintaxe, referências entre serviços, variáveis obrigatórias, topologia de rede.
Isso não substitui a execução, e o validador não finge que substitui.

### Três instâncias de banco, não três bancos

```yaml
# --- bases: três instâncias, não três bancos na mesma (ADR-0002)
bd-ops:    image: postgis/postgis:16-3.4   networks: [dados]
bd-pii:    image: postgis/postgis:16-3.4   networks: [cofre]
bd-audit:  image: postgis/postgis:16-3.4   networks: [dados]
```

```yaml
# Rede própria: só o compliance alcança o cofre. A separação da ADR-0002 aqui
# é de rede, não só de credencial.
```

Três instâncias separadas levam a separação até o processo do banco: comprometer
o PostgreSQL de `ops` não dá acesso ao de `pii`, porque são processos
diferentes em redes diferentes.

### Quatro redes como controle de acesso

```yaml
networks:
  # Quatro redes em vez de uma: a topologia é parte do controle de acesso.
  # Um serviço comprometido alcança apenas o que a rede dele alcança.
  dados:    cofre:    servicos:    cadeia:
```

| Serviço | Redes |
|---|---|
| `core` | `dados`, `servicos`, `cadeia` |
| `eudr` | `dados`, `servicos` |
| `compliance` | `cofre`, `servicos` |
| `web` | `servicos` apenas |

`web` não alcança banco nenhum. `eudr` não alcança a cadeia. `core` nunca esteve
na rede `cofre` — a impossibilidade de tocar PII é topológica, não apenas de
credencial.

### Variáveis obrigatórias

```yaml
CPR_SEGREDO_JWT: ${CPR_SEGREDO_JWT:?defina CPR_SEGREDO_JWT com 32+ caracteres}
CORS_ORIGENS: ${CORS_ORIGENS:?defina as origens aceitas}
SENHA_BD_OPS: ${SENHA_BD_OPS:?}
```

A sintaxe `:?` faz o compose **recusar subir** sem a variável. Não há padrão
silencioso para segredo nem para CORS — as duas coisas que, com padrão,
produzem ambiente aberto sem decisão de ninguém.

### O simulador no perfil de teste

```yaml
# O simulador de registradora só existe no perfil de teste. Em ambiente com
# dado real ele não sobe, e as rotas /sim já respondem 404 por ambiente.
```

Quinta camada de contenção, somada às quatro de `03-modelo-de-dados.md` §3.7.

### Besu

Quatro validadores QBFT em `infra/compose/besu/`, conforme ADR-0001.
**Nunca executado**, pelo mesmo motivo. O que está provado sobre os contratos
foi provado em nó Hardhat local.

---

## 9.5 Massa sintética: `infra/dados/massa.mjs`

Gera produtores, talhões, polígonos, bases de desmatamento e títulos. Semente
fixa → mesma massa (P6).

Inclui os casos-limite de propósito: talhão conforme, não conforme e
**limítrofe**.

O caso limítrofe é o que ensinou algo. O gerador criava um polígono meramente
**adjacente** à área de desmatamento — zero sobreposição — e o motor devolvia
`CONFORME`. O teste passava, o caso-limite nunca era exercitado, e o verde
afirmava o contrário do que verificava.

Hoje o gerador cria faixa de sobreposição de ~9 m, dentro da margem derivada da
resolução da base (SMC-009/010), e o caso produz `LIMITROFE` de verdade.

A lição vale para toda massa sintética: **um caso-limite que passa na primeira
tentativa provavelmente não é um caso-limite.**

---

## 9.6 Roteiros: `infra/demo/`

| Script | O que prova |
|---|---|
| `executar.mjs` | Ponta a ponta, 20 passos, do onboarding à liquidação |
| `aceite-conciliacao.mjs` | Injeta os 14 tipos de divergência e mede detecção |
| `aceite-auth.mjs` | 21 casos de autorização |
| `cliente.mjs` | Cliente HTTP compartilhado, com token por perfil |

`executar.mjs` sai com código 0 e imprime o que aconteceu em cada passo. Não é
teste unitário: é a demonstração de que as peças conversam.

### O que o placar mostra

```
detectados 13/14 — FALHOU em: TITULO_INEXISTENTE_NO_REGISTRO
nota (DUPLICIDADE_DE_ANCORA): Impossível por construção: o contrato reverte a
segunda emissão (P3). Detecção por prevenção, não por conciliação.
```

O placar reporta 13/14 e **nomeia o que falhou**. Arredondar para 14/14 —
contando a duplicidade de âncora como "detectada" porque é prevenida — seria
defensável em uma apresentação e falso num dossiê de portão.

---

## 9.7 CI: `.github/workflows/ci.yml`

```yaml
# Portão de qualidade. Cada passo corresponde a um princípio da Seção 2 do
# briefing; afrouxar qualquer um deles é mudança de contrato, não ajuste de CI.
#
# Dois trabalhos, de propósito: `contratos` é rápido e roda sempre; `integracao`
# sobe a pilha inteira e prova o que só a execução prova. Um CI que só verifica
# contrato dá a impressão de cobertura que o portão G1 desmentiu.
```

**Trabalho `contratos`** — PostGIS de serviço, três bases separadas criadas
explicitamente, e os validadores de `npm run validar`.

**Trabalho `integracao`** — sobe a pilha, roda a demonstração ponta a ponta, o
aceite de conciliação e o de autorização.

A separação existe porque G1 mostrou exatamente essa lacuna: validação de
contrato passando enquanto a execução real falhava. Contrato verifica que as
peças **declaram** encaixar; execução verifica que encaixam.

### `AMBIENTE=desenvolvimento` no CI

`env: AMBIENTE: desenvolvimento` e um segredo de CI de 32+ caracteres. É
necessário para que as rotas `/sim/*` existam e o aceite de conciliação possa
injetar divergência.

O efeito colateral é que o CI **não** exercita o caminho de produção das guardas
de ambiente. Por isso `aceite-auth.mjs` sobe um processo com
`AMBIENTE=producao` e verifica que `/sim/*` devolve 404 — o único lugar onde
esse caminho é testado.

---

## 9.8 O que a operação ainda não tem

Registrado em `docs/ESTADO-DO-PROTOTIPO.md`:

- **A composição nunca foi executada.** Nem a Besu.
- **Sem observabilidade além do log estruturado.** Não há métricas, tracing nem
  alerta — `sentinelaSla()` escreve em log de erro e ninguém é acordado.
- **Sem backup nem plano de recuperação.** Para `cpr_audit`, cuja premissa é
  imutabilidade, isso é lacuna séria: uma trilha perdida não se reconstrói.
- **Sem gestão de segredos.** Variáveis de ambiente, sem cofre nem rotação.
- **Os portões G2 e G3 nunca foram executados.**

---

**Próximo:** [10. Verificação](10-verificacao.md).
