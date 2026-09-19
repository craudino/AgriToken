# 4. Eventos e auditoria — como se reconstrói o que se sabia

> Contrato congelado: `docs/contracts/events/` — envelope, payloads, catálogo
> (23 tipos) e formato do registro de auditoria.

## 4.0 A pergunta que define o desenho

P5 exige que o sistema responda, **para qualquer contrato e qualquer
instante**: *o que se sabia, quando se soube e com base em quê.*

As três partes da pergunta viram estrutura:

| Pergunta | Onde mora |
|---|---|
| O que aconteceu | `tipo` + `payload` |
| Quando | `ocorrido_em` **e** `registrado_em` — dois campos, não um |
| Por ordem de quem | `ator_ref` + `ator_tipo` + `origem` |
| **Com base em quê** | `evidencia[]` |

A quarta é a que quase todo sistema de eventos omite, e é a única que importa em
disputa. Um log que diz "contrato congelado em 2026-03-14T10:22Z" não sustenta
nada. Um que diz "congelado com base no snapshot de registro `0xab…` obtido às
10:21 e no snapshot on-chain `0xcd…` do bloco 8842" sustenta.

---

## 4.1 O envelope

Formato único para todo evento da plataforma, em
`docs/contracts/events/envelope.schema.json`. `additionalProperties: false` —
campo não previsto **reprova**. Esquema permissivo vira depósito, e depósito não
se audita.

Campos com decisão embutida:

### `ocorrido_em` × `registrado_em`

```json
"registrado_em": { "description": "Quando a plataforma soube. A diferença entre
  os dois é a latência de detecção — métrica, não detalhe." }
```

Um único timestamp esconde justamente a informação que o MVP existe para
descobrir. A lacuna informacional nº 1 pergunta com que frequência e em quanto
tempo se detecta divergência entre registro e token: **a resposta é uma
subtração entre estes dois campos.** O placar de conciliação (125 ms do lado
registro, ~4,3 s do lado cadeia) sai daqui.

### `causa_id`

```json
"description": "Evento que causou este. Permite reconstruir a cadeia causal,
  não apenas a cronológica."
```

Ordem cronológica responde "o que veio antes". Cadeia causal responde "por que
isto aconteceu" — que é o que um auditor pergunta. Uma divergência detectada
aponta para o ciclo de conciliação que a produziu; o congelamento aponta para a
divergência.

### `origem` com versão obrigatória

```
^[a-z0-9/_-]+@[0-9]+\.[0-9]+\.[0-9]+$      →  services/core@1.2.0
```

O padrão **exige** a versão. Sem saber qual versão do código produziu o fato,
não se reproduz a execução — e P6 exige reprodutibilidade a partir do log.
Comportamento muda entre versões; um log que não diz qual versão rodou é um log
que descreve um sistema que já não existe.

### `sujeito.id` e `ator_ref`

```json
"id": { "description": "Identificador opaco. Nunca documento, nome ou e-mail (P2)." }
"ator_ref": { "pattern": "^[0-9a-f]{32}$" }
```

`ator_ref` é o pseudônimo de 128 bits de `novaRefOpaca()`, em hexadecimal. O
padrão do esquema recusa qualquer outra coisa — não dá para pôr um e-mail ali,
mesmo querendo.

### `payload_hash`

`sha256` da forma canônica. É o que liga o evento à trilha de auditoria e
permite provar, anos depois, que o payload guardado é o payload original.

---

## 4.2 O catálogo — 23 tipos, congelados

`docs/contracts/events/catalogo.json`. Cada entrada declara:

```json
{ "tipo": "conciliacao.divergencia-detectada", "produtor": "A2",
  "consumidores": ["A1","A6","A7"], "sujeito": "CONTRATO",
  "auditavel": true, "exige_evidencia": true }
```

| Domínio | Tipos |
|---|---|
| Contrato | `rascunho-criado`, `registrado`, `espelhado`, `transicionado`, `titularidade-alterada`, `liquidado` |
| Conciliação | `divergencia-detectada`, `contrato-congelado`, `divergencia-reconciliada` |
| Oráculo | `leitura-efetivada`, `quorum-perdido`, `disputa-aberta` |
| Mercado | `marcacao-atualizada` |
| EUDR | `evidencia-gerada`, `dds-emitida`, `selo-revogado`, `dds-revogada` |
| Garantia | `vinculada`, `excussao-registrada` |
| Privacidade / Compliance | `titular-eliminado`, `participante-desabilitado` |
| Plataforma / Credor | `incidente-aberto`, `reacao-registrada` |

Dois campos merecem explicação:

**`consumidores`** documenta o acoplamento entre agentes. Antes de mudar um
payload, vê-se quem quebra. É o que transforma "mudança de evento" em decisão
com custo visível em vez de commit silencioso.

**`exige_evidencia`** é a parte executável. Dezenove dos 23 tipos exigem
evidência, e `publicar()` recusa o evento sem ela. A regra decorre direto de P5:
se o tipo de fato é do tipo que precisa de lastro, o lastro não é opcional.

Os quatro que não exigem são os que não afirmam nada sobre o mundo externo:
rascunho criado, quórum perdido (a ausência **é** o fato), garantia vinculada
(a evidência está no contrato de garantia) e reação de credor (é opinião, e
opinião não tem lastro verificável — registrar isso como se tivesse seria pior
que não registrar).

**Todos os 23 são `auditavel: true`.** Não há evento que fique só na caixa de
saída.

### Os quatro tipos que G1 acrescentou

`contrato.titularidade-alterada`, `eudr.selo-revogado`, `eudr.dds-revogada` e
`compliance.participante-desabilitado` não existiam na Fase 0. Vieram do painel:
o catálogo original sabia registrar concessão e emissão, e **não sabia registrar
revogação**. Um sistema que emite selo e não sabe dizer que o revogou é um
sistema que afirma para sempre.

---

## 4.3 Os dois caminhos de escrita

```
ops.evento      — caixa de saída, na transação do fato, em cpr_ops
audit.registro  — trilha encadeada, append-only, em cpr_audit
```

`publicar()` escreve nos dois. A duplicação é intencional e as duas cópias têm
propósitos diferentes:

- **`ops.evento`** vive junto do estado que descreve, na mesma transação. Garante
  que fato e evento sejam atômicos, e serve de fonte para quem consome.
  `tg_evento_imutavel` impede alteração posterior.
- **`audit.registro`** vive em outra base, com outra credencial, encadeado por
  hash. Sobrevive ao comprometimento de `cpr_ops`.

Se alguém com acesso a `cpr_ops` adulterar `ops.evento`, a trilha em `cpr_audit`
continua íntegra e a divergência entre as duas é detectável. Essa é a razão
inteira de escrever duas vezes.

---

## 4.4 O que `publicar()` recusa

```ts
if (!meta) throw new Error(`evento fora do catálogo congelado: ${ev.tipo}`);
if (meta.exige_evidencia && evidencia.length === 0) throw new Error(`… exige evidência … (P5)`);
if (meta.sujeito !== ev.sujeitoTipo) throw new Error(`… é de sujeito ${meta.sujeito} …`);
```

Três recusas, antes de qualquer escrita. Detalhes em `02-nucleo.md` §2.2.

O ponto de arquitetura: **não existe caminho alternativo.** Nenhum serviço
escreve em `ops.evento` diretamente; todos passam por `publicar()`. Um `INSERT`
solto contornaria as três validações, e é por isso que a revisão de código
procura exatamente esse padrão.

---

## 4.5 A trilha encadeada

Formato em `registro-auditoria.schema.json`; DDL e gatilhos em
`03-modelo-de-dados.md` §3.4.

O que se prova com ela:

| Ataque | Como é detectado |
|---|---|
| Alterar um registro | `hash` recomputado diverge |
| Apagar um registro | `hash_anterior` do seguinte não bate |
| Inserir no meio | `seq` e a cadeia quebram |
| Reescrever tudo consistentemente | exige a credencial de `cpr_audit` **e** desligar três gatilhos |

`audit.verifica_cadeia()` roda em três lugares: no painel de auditoria (sob
demanda), na tarefa agendada `integridadeTrilha()` do core, e no CI.

A verificação é **O(n)**: recomputa a cadeia inteira. Para o volume do protótipo
é irrelevante; em produção precisaria de checkpoint periódico e verificação
incremental a partir dele — `verifica_cadeia(p_desde)` já recebe o parâmetro
para isso, e é o único preparo feito. Registrado como limitação conhecida.

---

## 4.6 O que a trilha deliberadamente não guarda

Nenhum campo identificável. `sujeito_id` é opaco, `ator_ref` é pseudônimo, e
dois `CHECK` recusam padrão de CPF e de e-mail no payload.

A razão é a que `CLAUDE.md` enuncia sem rodeios: **não existe direito à
eliminação em livro imutável.** Se um CPF entrar na trilha encadeada, removê-lo
quebra a cadeia — e não removê-lo viola a LGPD. O sistema ficaria entre duas
obrigações incompatíveis, por um descuido de quem escreveu um `INSERT`.

A saída é não admitir o dado. Quando a identidade é necessária, a trilha guarda
o pseudônimo e o cofre de PII guarda o vínculo — e o vínculo se destrói com a
chave (`03-modelo-de-dados.md` §3.5).

---

## 4.7 O que o CI verifica

`npm run validar:eventos`:

1. Todo payload no catálogo tem esquema em `payloads.schema.json`;
2. todo exemplo valida contra o próprio esquema;
3. **varredura de PII** sobre esquemas e exemplos — nome de campo ou valor com
   padrão de documento reprova;
4. `canonico()` (TypeScript) e `jsonb_canonical()` (PostgreSQL) produzem a mesma
   saída para os mesmos payloads;
5. `catalogo-eventos.ts` está sincronizado com `catalogo.json`.

A varredura de PII tem **autoteste**: injeta um payload com CPF e falha se a
varredura não acusar. Validador que não é testado contra o próprio alvo é
validador que passa a aceitar tudo sem ninguém notar — foi uma das críticas de
G1 e vale para todos os validadores do repositório (`10-verificacao.md`).

---

**Próximo:** [5. Contratos on-chain](05-contratos-onchain.md).
