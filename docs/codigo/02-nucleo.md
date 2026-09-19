# 2. Núcleo compartilhado — `packages/nucleo`

> 15 arquivos, 955 linhas. É a menor peça do sistema e a que mais importa:
> tudo aqui é **aquilo que não pode divergir entre serviços**.

## Por que existe um núcleo

Cinco serviços precisam concordar sobre o que é um evento válido, como se
calcula um hash, o que um escopo autoriza e qual é a forma canônica de um JSON.
Se cada um implementasse a sua versão, a divergência não apareceria como erro —
apareceria como dois hashes diferentes para o mesmo fato, meses depois, em uma
auditoria. P6 (determinismo) não sobrevive a duas implementações da mesma regra.

A regra de admissão ao núcleo é estreita: **entra o que, se divergir, quebra um
princípio.** Utilidade conveniente não entra; vai para o serviço que a usa.

| Módulo | Princípio que sustenta | O que quebraria sem ele |
|---|---|---|
| `canonico.ts` | P6 | Dois hashes para o mesmo payload |
| `eventos.ts` | P5 | Evento fora do catálogo, ou sem evidência |
| `auditoria.ts` | P5 | Trilha com hash calculado pelo próprio escritor |
| `auth.ts` / `guarda.ts` | P7 | Rota sem escopo declarado, aberta por esquecimento |
| `telemetria.ts` | P2 | CPF em linha de log |
| `config.ts` / `bd.ts` | P2 | Três bases apontando para o mesmo banco |
| `custo.ts` | (lacuna F5/F6) | Dossiê de G4 narrando o que deveria medir |
| `cadeia.ts` | P1 | Serviço conhecendo o código do contrato, não a ABI |

---

## 2.1 `canonico.ts` — a forma canônica

```ts
export const canonico = (v: unknown): string => { … }   // chaves ordenadas, sem espaços
```

Um mesmo objeto JavaScript serializa de formas diferentes conforme a ordem de
inserção das chaves. Se o hash do payload de um evento fosse calculado sobre
`JSON.stringify` cru, o mesmo fato produziria hashes distintos, e a trilha de
auditoria deixaria de ser reproduzível sem que nada falhasse visivelmente.

A mesma regra existe **duas vezes**, de propósito: aqui e em `jsonb_canonical`,
no banco de auditoria. Duas implementações independentes seriam um risco — por
isso `npm run validar:eventos` compara as duas sobre os mesmos payloads. Se
divergirem, o CI falha.

Três derivações merecem atenção:

- **`ancoraRegistro(entidade, registroId)` = `sha256("entidade|registroId")`.**
  Determinística por exigência de P3: a âncora é a chave de idempotência que
  torna impossível emitir dois espelhos para o mesmo registro. A mesma fórmula
  está em `cadeia.ts` (`ancoraDe`) e no contrato Solidity. `sha256`, não
  `keccak256` — a escolha é arbitrária, mas precisa ser a mesma nos três lugares,
  e é isso que os testes de invariante checam.
- **`novaRefOpaca()` = 16 bytes aleatórios.** Nunca derivada de documento.
  Pseudônimo derivado de CPF por hash é reversível por dicionário em minutos: o
  espaço de CPFs válidos é pequeno o bastante para enumeração exaustiva. Isto
  está registrado no ADR-0002 porque é exatamente o tipo de atalho que parece
  elegante ("assim o pseudônimo é determinístico!") e destrói P2.
- **`hmacDocumento(documento, chaveServico)`.** O índice cego do cofre de PII
  usa HMAC com chave de serviço, não hash simples, pela mesma razão: sem a
  chave, o dicionário não roda.

---

## 2.2 `eventos.ts` — o portão do catálogo

`publicar()` é o único caminho pelo qual um evento entra no sistema, e ele
recusa três coisas antes de escrever:

1. **Tipo fora do catálogo congelado.** O catálogo vem de
   `packages/nucleo/src/catalogo-eventos.ts`, que é **gerado** a partir de
   `docs/contracts/events/catalogo.yaml` por `infra/ci/gerar-tipos.mjs`. Não se
   inventa um tipo de evento no código: muda-se o contrato congelado, por SMC.
2. **Evidência ausente em evento que a exige.** O catálogo marca
   `exige_evidencia` por tipo. Afirmação sem lastro não entra na trilha — é a
   forma operacional de P5: "com base em quê" tem de ter resposta no momento em
   que o fato é gravado, não depois.
3. **Sujeito errado.** Um evento declarado `CONTRATO` no catálogo não pode ser
   publicado com sujeito `TALHAO`. Erro de cópia-e-cola aqui produziria uma
   trilha que consulta nenhuma query encontra.

A escrita acontece **dentro da transação do fato** (`publicar` recebe um
`PoolClient`, não um `Pool`). A razão é dura: um fato gravado cuja publicação
falhou é um fato que o resto do sistema nunca soube. Ou os dois acontecem, ou
nenhum.

É o padrão *outbox*: `ops.evento` é a caixa de saída, e quem consome lê dali.

---

## 2.3 `auditoria.ts` — por que o hash é do banco

```ts
// O encadeamento de hash é feito pelo banco (audit.fn_encadeia), e não aqui,
// de propósito: um escritor que calculasse o próprio hash poderia forjá-lo.
```

Esta é a decisão mais contraintuitiva do núcleo. Seria mais simples calcular o
hash em TypeScript e inserir. Mas então a integridade da trilha dependeria da
boa-fé do processo que escreve, e um processo comprometido produziria uma cadeia
internamente consistente e inteiramente falsa.

Com o encadeamento no gatilho do banco, o escritor **entrega o fato e não
controla o elo**. Para forjar a cadeia é preciso comprometer o banco de
auditoria, que tem credencial própria, roda com papel próprio e cujos gatilhos
recusam `UPDATE` e `DELETE`. Ver `03-modelo-de-dados.md` §3.4.

`verificarCadeia()` chama `audit.verifica_cadeia()` e devolve
`{ registros, inconsistentes }`. Alimenta o painel de auditoria e a tarefa
agendada `integridadeTrilha()` do core.

---

## 2.4 `auth.ts` e `guarda.ts` — recusa por omissão

O detalhe que define a postura inteira está em `GuardaEscopo`:

```ts
const exigidos = this.reflector.getAllAndOverride<Escopo[]>(CHAVE_ESCOPOS, alvos);
if (!exigidos) throw new HttpException({ …, status: 403, principio_violado: 'P7' }, 403);
```

**Rota sem `@Escopos` e sem `@Publica` responde 403** — não 200. A alternativa
comum (rota sem anotação é pública) transforma esquecimento em vulnerabilidade
silenciosa. Aqui, esquecimento vira falha no primeiro teste.

`@Publica()` existe, e é usado em `/saude`. O ponto não é proibir rota pública:
é fazer com que abrir uma apareça no diff como ato deliberado, com nome próprio.

`GuardaSimulador` roda **antes** da autenticação e devolve 404 — não 403 — para
qualquer `/sim/*` fora de desenvolvimento. 404 porque 403 confirmaria a
existência da superfície. A rota que injeta divergência em registro não pode
existir onde há dado real, nem com o token correto.

Detalhes de perfis e escopos: `07-autenticacao.md`.

---

## 2.5 `cliente.ts` — a delegação que não acontece

```ts
// Cada serviço se identifica com token próprio de perfil `servico` — não com
// o token do usuário que originou a requisição.
```

Repassar o token do usuário é o padrão mais comum em arquitetura de
microsserviços e é uma armadilha: o serviço passa a agir com a autoridade de
quem chamou, e um credor consegue por via indireta o que o escopo dele recusa na
porta da frente. *Confused deputy* é assim que autorização correta vira
autorização inútil. [#REF]

O custo é real: o serviço chamado não sabe qual humano originou a cadeia. Por
isso a correlação (`x-correlacao-id`) atravessa as chamadas e a trilha de
auditoria guarda o ator do fato original. Identidade para autorização e
identidade para auditoria são coisas diferentes, e aqui elas viajam separadas.

O token de serviço é cacheado com margem de 30 s antes do vencimento — evita
emitir um token por chamada sem correr o risco de usar um que expira em trânsito.

---

## 2.6 `config.ts` e `bd.ts` — separação que começa na credencial

`urlBase('ops' | 'pii' | 'audit')` exige a variável **de quem usa**, não as três
em bloco. A versão anterior obrigava todo serviço a declarar `PII_URL`, e a
saída fácil para subir um serviço que não toca o cofre era apontar a variável
para outro banco qualquer. Isso é pior que não validar: troca "não alcança o
cofre" por "alcança o cofre com o endereço errado". Corrigido em **SMC-012**.

A validação que permaneceu: se duas credenciais declaradas apontarem para o
mesmo `host` + `pathname`, o processo falha na partida. A separação física das
três bases é premissa de segurança (ADR-0002), não convenção de nomenclatura.

`bd.ts` mantém **um pool por base, criado sob demanda**. O serviço que não
precisa do cofre não recebe o pool do cofre — a separação começa na conexão,
antes de qualquer controle de acesso.

---

## 2.7 `telemetria.ts` — o vazamento que ninguém revisa

Log é o vetor de vazamento de PII mais comum e o menos vigiado: ninguém revisa
linha de log em code review. `higienizar()` percorre recursivamente o objeto e
substitui CPF, CNPJ e e-mail por `[CPF_SUPRIMIDO]` e afins **antes** de escrever.

É defesa em profundidade, não a defesa principal — a principal é não colocar o
dado no objeto. Mas P2 diz que o erro aqui é irreversível, e defesa irreversível
merece duas camadas.

O log é JSON estruturado com `correlacao_id` obrigatório no contexto. A
correlação não é conforto de depuração: é a chave que liga evento, registro de
auditoria e resposta de API. Sem ela, "o que se sabia, quando, com base em quê"
não fecha.

---

## 2.8 `problema.ts` — o erro que nomeia o princípio

RFC 9457 (*Problem Details for HTTP APIs*) com um campo a mais:
`principio_violado`. [#REF]

```json
{
  "type": "https://cpr.digital/erros/contrato-congelado",
  "title": "Contrato congelado por divergência de conciliação",
  "status": 409,
  "principio_violado": "P1"
}
```

Quem consome a API descobre **por que** a recusa aconteceu, não só que
aconteceu. `congelado()` → P1, `semQuorum()` → P4, `ancoraEmUso()` → P3. A
fronteira fica visível na resposta, e não apenas no código-fonte de quem a
implementou.

---

## 2.9 `custo.ts` — a lacuna que E6 apontou

Em G1, o economista institucional (E6) observou que **seis das oito lacunas
informacionais do MVP são de custo**, e que nada no sistema media custo. O
dossiê de G4 teria de narrar exatamente aquilo que deveria demonstrar.

`comCusto()` cronometra uma etapa e grava em `ops.custo_verificacao` — inclusive
quando a etapa falha, porque tentativa fracassada custa e o custo de falhar é
metade da resposta sobre viabilidade.

Registrado como **SMC-007**.

---

## 2.10 `cadeia.ts` — a fronteira com A1

O núcleo carrega **ABIs**, nunca código de contrato. É a fronteira entre A2 e
A1: os serviços conhecem a interface congelada em `docs/contracts/abi/`, e a
implementação pode mudar sem que nada em `services/` saiba.

As chaves privadas no arquivo são as determinísticas do nó de desenvolvimento
Hardhat, públicas e universalmente conhecidas. Em produção, HSM — está
comentado no código e registrado no ADR-0008 como desvio consciente do protótipo.

---

## 2.11 `tipos.ts` e `catalogo-eventos.ts` — gerados, não escritos

```ts
// GERADO POR infra/ci/gerar-tipos.mjs — NÃO EDITE À MÃO.
```

Estados de contrato, tipos de divergência, situações de conciliação e o catálogo
de eventos existem **uma vez**, em `docs/contracts/`, e são derivados para
TypeScript por script. Editar o arquivo gerado é a forma mais rápida de produzir
um sistema em que o contrato congelado diz uma coisa e o código faz outra.

O CI regenera e compara: divergência falha o build.

---

**Próximo:** [3. Modelo de dados](03-modelo-de-dados.md) — o que o banco recusa
sozinho, sem depender de uma linha de aplicação.
