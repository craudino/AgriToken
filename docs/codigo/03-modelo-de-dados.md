# 3. Modelo de dados — três bases, e o que o banco recusa sozinho

> `docs/contracts/db/` — 19 arquivos, 1.495 linhas de DDL. **Congelado.**
> Mudança exige SMC em `docs/contracts/MUDANCAS.md`.

## 3.0 A postura: controle preventivo na base

A maior parte dos sistemas põe as regras de integridade na aplicação e usa o
banco como depósito. Aqui é o contrário sempre que a regra decorre de um
princípio.

O motivo é simples de enunciar e desconfortável de aceitar: **código de
aplicação tem prazo de validade e caminhos alternativos.** Um script de
correção, uma migração de emergência, um serviço novo escrito por outra equipe
— qualquer um deles contorna a validação que mora no serviço. Não contorna um
`CHECK`, um gatilho ou uma revogação de `GRANT`.

Então a pergunta de projeto, para cada regra, foi: *se alguém conectar no banco
com `psql` e tentar fazer isto, o banco recusa?* Onde a resposta precisava ser
"sim", a regra desceu para o DDL.

---

## 3.1 Por que três bases

| Base | Conteúdo | Credencial | Papéis |
|---|---|---|---|
| `cpr_ops` | Domínio operacional, **sem PII** | `OPS_URL` | `cpr_app`, `cpr_geo`, `cpr_ro`, `cpr_sim` |
| `cpr_pii` | Cofre de dados pessoais, tudo cifrado | `PII_URL` | separada |
| `cpr_audit` | Trilha encadeada, append-only | `AUDIT_URL` | `cpr_audit_writer`, `cpr_audit_reader` |

Não são três *schemas*: são três bases, com três credenciais distintas
(ADR-0002). Um `JOIN` entre operação e PII é **impossível de escrever** — não é
"proibido por convenção", é sintaticamente inalcançável a partir de uma conexão.

O vínculo entre as duas existe como ponteiro sem chave estrangeira:
`pii.titular.ops_produtor_id`. O comentário no DDL diz `sem FK (base distinta)`,
e essa ausência é o ponto. A integridade referencial que se perde é o preço da
separação que se ganha.

`packages/nucleo/src/config.ts` fecha o cerco do lado da aplicação: se duas
credenciais apontarem para o mesmo `host` + `pathname`, o processo não sobe.

### Schemas dentro de `cpr_ops`

```
ops   — domínio operacional (37 tabelas/visões)
geo   — geometrias BRUTAS; acesso restrito ao papel cpr_geo (3 tabelas)
sim   — simulador de registradora; NUNCA promovido a produção (2 tabelas)
```

`REVOKE ALL ON SCHEMA geo FROM cpr_ro, cpr_app` — o papel somente-leitura do
painel de auditoria **jamais** enxerga polígono bruto. Coordenada de propriedade
rural é dado pessoal na prática: identifica o titular com precisão maior que o
endereço. O painel vê o centroide ofuscado de `geo.talhao_ofuscado`
(≥ 5 km de deslocamento), nunca a geometria de `geo.talhao_geometria`.

---

## 3.2 Domínios: P2 como restrição de tipo

```sql
CREATE DOMAIN ops.texto_sem_pii AS text
  CONSTRAINT sem_cpf   CHECK (VALUE !~ '…CPF…')
  CONSTRAINT sem_cnpj  CHECK (VALUE !~ '…CNPJ…')
  CONSTRAINT sem_email CHECK (VALUE !~ '…email…');
```

Todo campo de texto livre em `cpr_ops` usa este domínio. `congelado_motivo`,
`motivo` de transição, descrição de incidente — os lugares onde um operador
apressado escreveria "divergência confirmada com João da Silva, CPF
123.456.789-00". A inserção falha **na base**, não no code review.

É controle preventivo, não detectivo: o dado não entra. Em livro imutável não
existe direito à eliminação, e um vazamento não se recolhe — o custo de errar
aqui é permanente, o que justifica o custo de verificar sempre.

Outros domínios com propósito:

- **`ops.ref_opaca`** — `bytea` de exatamente 16 bytes. O comentário do DDL
  carrega o motivo: *"Jamais derivado de PII: derivar de CPF permitiria
  reidentificação por dicionário (10^11 candidatos)"*. O tipo não consegue
  impedir que alguém insira um hash de CPF de 16 bytes; o comentário e o
  ADR-0002 existem porque essa é a tentação, e ela precisa estar nomeada.
- **`ops.hash32`** — 32 bytes, nunca hexadecimal solto em `text`. Hash guardado
  como texto convida a comparação com maiúsculas/minúsculas divergentes e
  prefixo `0x` inconsistente.
- **`ops.pct`** — `numeric(7,4)` entre 0 e 100.

### O defeito do `ops.pct`, e o que ele ensinou

`ltv_pct` (*loan-to-value*) usava `ops.pct`. Parecia natural: é uma
porcentagem. Mas LTV **passa de 100%** exatamente na situação que importa
medir — quando a garantia vale menos que a dívida.

O domínio tornava a subcolateralização *inexprimível*. O cenário de estresse não
falhava com erro: ele simplesmente não conseguia representar o estado que
deveria demonstrar.

**SMC-011** trocou por `numeric(10,4) CHECK (ltv_pct >= 0)`. O cenário de
estresse hoje mostra LTV indo de 127% a 192%.

A lição é generalizável e vale para todo este documento: **restrição de
domínio protege contra dado inválido e, no mesmo gesto, pode proibir a
realidade.** A pergunta certa não é "qual a faixa normal?", é "qual a faixa em
que ainda preciso enxergar o que está acontecendo?".

---

## 3.3 A máquina de estados — grafo como dado

```sql
CREATE TABLE ops.transicao_permitida (
  de ops.estado_contrato, para ops.estado_contrato, guarda text,
  PRIMARY KEY (de, para)
);
```

O grafo de transições é **linha de tabela**, não `switch` em TypeScript. Nove
estados, catorze transições permitidas. A mesma tabela alimenta o domínio e a
base, e o CI compara as duas cópias.

Três gatilhos defendem o grafo:

### `tg_valida_transicao`

Recusa transição fora do grafo — e recusa também **a guarda errada para a
transição certa**. Sem esta segunda checagem (SMC-001), o chamador escolheria o
rótulo da guarda, e o rótulo é o que aparece na auditoria. A auditoria passaria
a registrar a justificativa que o chamador preferiu, não a que o grafo exige.

### `tg_bloqueia_congelado` — P1 em forma executável

Este gatilho é a peça central do sistema. Contrato com `situacao_conciliacao =
'CONGELADO'` não muda de estado, ponto — **exceto** pela saída reconciliada, que
exige, cumulativamente:

1. `guarda = 'divergencia_reconciliada'`;
2. `divergencia_id` não nulo;
3. a divergência **existe**;
4. pertence **a este contrato**;
5. está em `RECONCILIADA` ou `FALSO_POSITIVO`;
6. tem `reconciliada_por` preenchido (operador humano identificado);
7. `ator_tipo = 'HUMANO'` com `ator_ref` preenchido;
8. **nenhuma outra divergência aberta** no contrato.

O histórico importa. Na primeira versão, bastava escrever a string
`divergencia_reconciliada` na coluna de guarda para destrancar o contrato — sem
divergência, sem operador, sem ator. **O red team reproduziu o ataque em G1.**
A correção foi trocar a string por uma chave estrangeira: agora a saída exige
prova, e a prova é uma linha de `ops.divergencia` com humano identificado.

A condição 8 fecha um segundo buraco: reconciliar *uma* divergência não
destranca o contrato se ainda houver outra aberta. **O congelamento acompanha o
contrato, não o incidente.**

### O efeito colateral que quebrou o código de aplicação

Este gatilho bloqueia transições em contrato congelado. `ConciliacaoService.
registrarDivergencia()` fazia, nesta ordem: (a) congelar o contrato,
(b) registrar a transição `ATIVO → EM_DISPUTA`.

O passo (b) era bloqueado pelo passo (a). Meu próprio gatilho recusava o meu
próprio fluxo legítimo.

A correção **não** foi afrouxar o gatilho: foi inverter a ordem — transição de
disputa primeiro, congelamento depois. Está em `CLAUDE.md` como princípio
("em conflito entre conveniência de implementação e princípio: pare e escale.
Não contorne") e este foi o caso real em que ele se aplicou.

---

## 3.4 `cpr_audit` — append-only por construção

```sql
hash = sha256(hash_anterior || id || tipo || sujeito || ocorrido_em || jsonb_canonical(payload))
```

Bloco gênese: 32 bytes de zero. Cada registro encadeia no anterior.

**O encadeamento é do gatilho `tg_encadeia`, não do escritor.** Quem insere
entrega o fato e não controla o elo. Ver `02-nucleo.md` §2.3.

Três gatilhos recusam `UPDATE`, `DELETE` e `TRUNCATE` com exceção explícita —
mais `REVOKE UPDATE, DELETE, TRUNCATE … FROM PUBLIC`. Cinto e suspensórios: o
`REVOKE` pode ser desfeito por um superusuário distraído; o gatilho continua
recusando.

`audit.verifica_cadeia(p_desde)` recomputa a cadeia inteira e devolve
`(seq, ok, motivo)` por registro. Detecta tanto alteração quanto **supressão**:
remover um registro quebra o elo do seguinte.

`jsonb_canonical()` é a gêmea de `canonico()` em TypeScript. Duas
implementações da mesma regra são um risco declarado, e por isso
`npm run validar:eventos` compara as duas sobre os mesmos payloads.

A tabela ainda carrega `CHECK payload_sem_cpf` e `payload_sem_email` — P2
aplicado ao lugar onde o erro seria definitivo.

---

## 3.5 `cpr_pii` — o cofre e o crypto-shredding

Nenhuma coluna identificante em texto claro. Todas terminam em `_cif`:
`nome_cif`, `documento_cif`, `contato_cif`, `endereco_cif`,
`dados_bancarios_cif`, `car_numero_cif`. AES-256-GCM, **uma chave por titular**.

```sql
COMMENT ON TABLE pii.chave_titular IS
  'Uma chave por titular. Chave compartilhada entre titulares tornaria a
   eliminação individual impossível — o erro clássico de projeto que E2 procura.';
```

**O modelo de eliminação:** a chave vive no KMS; aqui existe só `kms_key_ref`.
Eliminar o titular é **destruir a chave**, e o texto cifrado remanescente vira
ruído. Isto resolve a tensão entre o direito à eliminação da LGPD e a
imutabilidade da trilha: o registro de auditoria permanece (a trilha não pode
ter buracos), e o conteúdo identificável torna-se irrecuperável. [#REF]

`CHECK destruicao_tem_comprovante` exige que `destruida_em` e `destruicao_ref`
existam juntos: a destruição carrega comprovante do KMS, ou não aconteceu.

**Busca sem decifrar:** `documento_hmac` é HMAC-SHA256 com chave de serviço
rotacionável, `UNIQUE`. Permite "existe titular com este CPF?" sem decifrar
nada — e sem ser reversível por dicionário, o que um hash simples seria.

`pii.base_legal` e `pii.operacao_tratamento` formam o ROPA (registro de
operações de tratamento) exigido pelo Art. 37 da LGPD. [#REF] Não é documento
em Word: é tabela, consultável, ligada às operações reais.

---

## 3.6 Quórum e disputa — P4 na base

Dois gatilhos em `060_oraculos.sql`:

- **`tg_valida_quorum_leitura`** — leitura `CONTRATUAL` não atinge estado
  `EFETIVA` sem o número mínimo de fontes de `ops.politica_quorum`.
- **`tg_valida_uso_leitura`** — impede que leitura `INFORMATIVA`, `SEM_QUORUM`
  ou `EM_DISPUTA` seja registrada como insumo de decisão contratual em
  `ops.uso_leitura`.

O segundo é o que torna P4 estrutural. Sem ele, um serviço poderia ler o preço
de uma fonte só, marcá-lo como informativo, e usá-lo para mover MTM — o quórum
existiria no papel e não no caminho de execução.

`ops.criticidade_leitura` carrega o comentário: *"INFORMATIVA não pode, por
construção, ser insumo de decisão contratual."*

---

## 3.7 O schema `sim` — a superfície que precisa existir e não pode vazar

`sim.titulo` e `sim.injecao` simulam a registradora. É onde se injeta a
divergência que a conciliação deve detectar — sem isso, a lacuna informacional
nº 1 ("com que frequência registro e token divergem?") não teria como ser
investigada.

Também é a superfície mais perigosa do sistema: quem escreve em `sim.titulo`
altera aquilo que o sistema trata como verdade registral.

Quatro camadas a contêm:

1. Schema separado, papel `cpr_sim` próprio;
2. `GRANT` de escrita apenas em `sim` — nunca em `ops`;
3. escopo `simulador:operar`, recusado fora de `AMBIENTE=desenvolvimento`
   (`auth.ts`);
4. `GuardaSimulador` devolve **404** para `/sim/*` fora de desenvolvimento,
   antes mesmo da autenticação.

Comentário no DDL: `'Simulador de registradora; NUNCA promovido a produção'`.

---

## 3.8 Instrumentação de custo e reação de credor

`ops.custo_verificacao` (SMC-007) e `ops.reacao_credor` existem por observação
de E6 em G1: as lacunas informacionais do MVP são majoritariamente **de custo e
de disposição a pagar**, e nada no sistema media nem uma nem outra.

As visões `vw_custo_por_produtor` e `vw_custo_selo_eudr` respondem
"quanto custou verificar este produtor" e "quanto custa um selo EUDR" a partir
de medição, não de estimativa.

`ops.reacao_credor` permanece com poucos registros. É honesto dizer o motivo:
a lacuna **F7** (disposição do credor a pagar pela verificação) exige credor
real, e o protótipo não tem. Ver `docs/ESTADO-DO-PROTOTIPO.md`.

---

## 3.9 Visões de auditoria

- **`vw_conhecimento_contrato`** — responde literalmente à pergunta de P5:
  "o que se sabia, quando se soube e com base em quê", por contrato, em ordem
  cronológica, unindo transições, leituras usadas e evidências.
- **`vw_placar_conciliacao`** — placar por tipo de divergência: detectado,
  latência, congelou.
- **`vw_contratos_sem_dado_confiavel`** — contratos cuja decisão depende de
  leitura sem quórum ou em disputa. A pergunta que um credor faz antes de
  comprar risco.

---

## 3.10 Os testes de conformidade

`docs/contracts/db/testes/conformidade_ops.sql` e `conformidade_audit.sql` não
testam funcionalidade: **testam recusa**. Cada bloco executa um ataque e falha
se o banco aceitar.

Entre eles: inserir CPF em campo `texto_sem_pii`; transicionar contrato
congelado; destrancar congelamento sem divergência; alterar registro de
auditoria; apagar registro de auditoria; usar leitura sem quórum em decisão
contratual; emitir segundo espelho para a mesma âncora.

`npm run validar:esquema` sobe bases efêmeras, aplica o DDL inteiro e roda estes
arquivos. Um DDL que passa a aceitar o que deveria recusar falha o build.

---

**Próximo:** [4. Eventos e auditoria](04-eventos-e-auditoria.md).
