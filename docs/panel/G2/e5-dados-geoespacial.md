# Parecer E5 — Modelagem geoespacial, qualidade de polígonos, governança de oráculos e linhagem — Portão G2

> Parecer emitido com contexto isolado. HEAD no início `162f48e`, ao final `8209ff8`
> (o parecer de E2 entrou durante a revisão). Reproduzido íntegro, sem edição do
> orquestrador. Árvore de trabalho limpa; provas de mutação em `BEGIN/ROLLBACK`.

## Veredicto: **REPROVA**

Não é um juízo sobre esmero — o código é cuidadoso e os comentários são honestos com frequência incomum. É um juízo sobre quatro coisas que verifiquei executando, não lendo:

1. Um talhão a **5,05 m** de um polígono de desmatamento pós-corte, contra base de 30 m, está gravado hoje na base como **`CONFORME`**, com `area_sobreposta_ha = 0` e a margem de 2,68 ha calculada e descartada. A margem existe de um lado só.
2. Um **bump de versão de base** — uma linha em `ops.base_referencia_geo`, sem recarregar geometria — transforma um talhão de `NAO_CONFORME` com 1,993 ha de sobreposição em `CONFORME`. Provado por execução.
3. **Três produtores distintos** detêm hoje talhões com `poligono_hash` byte a byte idêntico e 100% de sobreposição geométrica (19,5499 ha), produzidos pelo próprio `npm run demo`. Nada no sistema notou.
4. `contarIndependentes` é **dependente da ordem das linhas** e não fecha transitividade. O mecanismo que o ADR-0003 e o caso C3 do aceite apresentam como a defesa contra redundância aparente falha exatamente no caso que a documentação descreve.

Qualquer um dos itens 1 a 3 contamina colateral e DDS. O item 4 desfaz P4 no ponto em que ele foi declarado resolvido.

---

## CRÍTICA

### C1. A margem de incerteza é aplicada só no lado de dentro: sobreposição zero vira `CONFORME` sem passar pela margem
`services/eudr/src/eudr.service.ts:81`
```ts
const resultado = area === 0 ? 'CONFORME' : area <= margemHa ? 'LIMITROFE' : 'NAO_CONFORME';
```
`area === 0` curto-circuita antes de qualquer consideração de resolução. `ST_Intersects` é exato; a base não é. Medido na base viva:

| talhão | apelido | distância ao DESM-001 (PRODES, `resolucao_m`=30) | intersecta | resultado gravado |
|---|---|---|---|---|
| `1ae950c1-151e-4246-9bbc-442b51d119ab` | `QUASE-ENCOSTA-5m` | **5,05 m** | `f` | **`CONFORME`** |

A margem de 2,68 ha foi calculada para esse talhão, gravada em `bases[].margem_ha`, e não foi usada. Um talhão a 5 m de desmatamento detectado, medido por sensor cuja célula tem 30 m, está dentro de uma célula [#REF — não conferi nesta sessão a resolução nominal nem o erro de georreferenciamento do PRODES/MapBiomas; uso o valor `resolucao_m=30` que o próprio repositório declara em `infra/db/referencia.sql:28-29`]. A faixa em que "conforme" e "não conforme" não se distinguem é simétrica em torno da borda, e este código só enxerga metade dela.

Agrava: `ops.evidencia_eudr` tem `CONSTRAINT conforme_sem_sobreposicao CHECK (resultado <> 'CONFORME' OR area_sobreposta_ha = 0)` (`docs/contracts/db/ops/070_eudr.sql:56`) — o banco **exige** que `CONFORME` tenha sobreposição exatamente zero, isto é, codifica a assimetria como invariante de contrato congelado. `emitirDds` (`eudr.service.ts:204`) só barra o que não é `CONFORME`; este talhão emite DDS.

A massa sintética diagnosticou o problema e não o corrigiu — `infra/dados/massa.mjs:119-120`: *"Um polígono meramente adjacente não testa nada — dá sobreposição zero e o motor acerta por acidente."* A conclusão tirada foi deixar de gerar o caso, não tratá-lo. O caso existe na base viva, sob o nome `QUASE-ENCOSTA-5m`, e passou.

**Correção:** classificar `LIMITROFE` também quando `ST_DWithin(talhao, desmatamento, resolucao_m/2)` com interseção nula, e derrubar `conforme_sem_sobreposicao` como invariante — ela impede representar o único estado que interessa aqui.

### C2. Bump de versão de base falha **aberto**: NÃO CONFORME vira CONFORME por uma linha em tabela
`services/eudr/src/eudr.service.ts:61-63` e `:37-45`; `services/eudr/src/geo.service.ts:22-32`; `docs/contracts/db/ops/070_eudr.sql:26-33`

`avaliar` e `cruzarBase` sempre usam `SELECT DISTINCT ON (codigo) ... ORDER BY codigo, versao DESC` — a versão **mais recente** da base. `geo.desmatamento` é chaveada por `(base_id, id)`, isto é, por *versão* de base. `carregarBases` só carrega geometria para a versão mais recente existente **no momento em que roda**, com `ON CONFLICT DO NOTHING`. Não há verificação de que a versão vigente tenha polígono carregado, nem conferência contra `base_referencia_geo.hash_dataset`.

Provado em transação revertida:
```
INSERT INTO ops.base_referencia_geo (codigo,versao,...) VALUES ('PRODES','2026.1',...);
-- query idêntica à de cruzarBase, talhão f0faa133 (hoje NAO_CONFORME, 1,993 ha):
  codigo   | versao | area_sobreposta_ha
-----------+--------+--------------------
 MAPBIOMAS | 9.0    |                  0
 PRODES    | 2026.1 |                  0        <-- era 1,9930
ROLLBACK
```
Com ambas as bases em `CONFORME`, a agregação `INTERSECAO` do oráculo devolve `CONFORME`, o quórum fecha `EFETIVA`, a evidência grava `CONFORME` com `area_sobreposta_ha = 0` (satisfazendo o CHECK) e a DDS é emitível. Base vazia e base limpa são indistinguíveis por construção — o sistema não sabe diferenciar "não há desmatamento" de "não há dado".

**Correção:** `cruzarBase` deve resolver a base por `(codigo, versao)` fixada na evidência, e a avaliação deve recusar base cuja contagem de feições carregadas seja zero ou cujo `hash_dataset` não confira com o que foi ingerido.

### C3. A mesma terra está registrada sob três produtores, com hash idêntico, e o caminho de escrita permite repontar o colateral alheio
`docs/contracts/db/ops/030_produtor_e_talhao.sql:34-58` e `:63-73`; `services/eudr/src/geo.service.ts:80-96`

Estado vivo de `cpr_ops`:

| talhao_id | produtor (`ref_opaca`) | apelido | poligono_hash |
|---|---|---|---|
| `d59cddbb-…` | `631de5b7…` | Baixada 2 | `1f6b6b0b…2e0229` |
| `c9bea7ca-…` | `afd60732…` | Baixada 2 | `1f6b6b0b…2e0229` |
| `73e2d54d-…` | `eabf580b…` | Baixada 2 | `1f6b6b0b…2e0229` |

Sobreposição par a par: **19,5499 ha sobre 19,5499 ha** — coincidência total. Origem é reproduzível e está no repositório: `infra/demo/executar.mjs:70-75` ingere sempre `massa.talhoes.find(t => t.perfil_esperado === 'CONFORME')` — o mesmo polígono — para um produtor novo a cada execução. Três execuções de `npm run demo`, três produtores, o mesmo hectare, três selos EUDR independentes, três colaterais.

Não existe constraint de exclusão espacial, nem `UNIQUE` em `poligono_hash`, nem checagem de sobreposição em lugar nenhum (`grep` por `ST_Overlaps|EXCLUDE|ST_Contains` no DDL congelado e em `services/`: zero ocorrências fora do cruzamento EUDR). P3 — *"tornar estruturalmente impossível mobilizar duas vezes a mesma garantia"* — está ancorado no identificador de registro da CPR e em nada na terra.

Segunda porta no mesmo caminho de escrita: o `ON CONFLICT (id) DO UPDATE` de `geo.service.ts:83-88` atualiza `area_calculada_ha`, `poligono_hash` e `poligono_versao` **sem incluir `produtor_id` na cláusula de conflito nem reconferi-lo**. Quem tiver escopo `geo:ingerir` e souber um `talhao_id` alheio (o campo é aceito no corpo, `geo.service.ts:43`) substitui o polígono do colateral de outro produtor; a posse permanece com a vítima e a geometria passa a ser a do atacante, com `poligono_versao` incrementada e nova linha em `geo.talhao_geometria`.

**Correção:** constraint de exclusão espacial (ou verificação transacional de sobreposição com bloqueio) entre talhões de produtores distintos, com exceção explícita e registrada para condomínio/arrendamento; `WHERE ops.talhao.produtor_id = EXCLUDED.produtor_id` no `DO UPDATE`.

### C4. `contarIndependentes` depende da ordem das linhas e não fecha transitividade — o quórum independente é inflável
`services/oracle/src/quorum.service.ts:46-57`, agravado por `:35` (`SELECT ... WHERE tipo_leitura = $1 AND ativa`, **sem `ORDER BY`**)

O laço insere cada fonte no **primeiro** grupo compatível e nunca funde grupos já criados. Réplica exata da função (`/tmp/g2/indep.mjs`):

```
-- dois republicadores do mesmo boletim (X e Y declaram independente_de={CEPEA}),
-- exatamente o padrão de declaração unilateral usado em infra/db/referencia.sql:10
CEPEA,X,Y => 1     X,CEPEA,Y => 1     X,Y,CEPEA => 2  ❌     Y,X,CEPEA => 2  ❌

-- cadeia transitiva A~B, B~C
A,B,C => 1     A,C,B => 2  ❌     C,A,B => 2  ❌

-- os dois republicadores sozinhos, com o boletim primário caído
X,Y => 2  ❌
```

Três defeitos compostos:
- **Ordem decide o quórum.** `fontesDe` não ordena; a ordem é a do heap do Postgres e muda com `UPDATE`/`VACUUM`. O mesmo conjunto de fontes produz `fontes_independentes` = 1 ou 2 conforme o dia. Isso é P6 quebrado (`determinismo`) no número que decide efeito contratual.
- **Sem transitividade.** Dois agregadores do mesmo boletim, correlacionados apenas *através* do boletim, contam como 2. É literalmente o caso descrito no comentário do contrato congelado (`docs/contracts/db/ops/060_oraculos.sql:17-20`: *"dois agregadores que consomem o mesmo boletim"*) e é o que falha.
- **Sem a fonte primária, a correlação evapora.** Caso `X,Y => 2`: se o CEPEA cai e dois republicadores continuam servindo o boletim de ontem, o sistema declara 2 fontes independentes e segue decidindo contrato sobre uma origem morta. É a redundância aparente do ADR-0003 na sua forma mais perigosa.

Com a configuração atual (um único republicador) o bug não morde, e é por isso que o caso C3 do aceite passa. O caso C3 prova o caso que o algoritmo acerta.

**Correção:** union-find sobre o fecho transitivo e simétrico da relação declarada, com ordenação determinística das fontes; e a relação deve ser modelada como "mesma origem" (grafo de proveniência), não como "não sou independente de".

### C5. O quórum GEOESPACIAL é uma única computação circulando por si mesma; o "payload cru" arquivado é o veredito derivado
`services/eudr/src/eudr.service.ts:86-96`; `services/oracle/src/fontes.ts:76-91`; `services/oracle/src/app.controller.ts:157-166`

`avaliar` cruza as duas bases **com o mesmo motor, a mesma query, o mesmo polígono, no mesmo processo**, faz `POST /leituras/fonte` com cada resultado, e em seguida pede ao oráculo que "colete". `lerGeo` devolve de volta o que acabou de receber. O oráculo não verifica nada: ele carimba quórum sobre a própria saída do serviço que o consulta. P4 é satisfeito na forma e não no conteúdo. O ADR e o comentário de `app.controller.ts:153-155` registram a dívida com honestidade — mas o que o portão está avaliando é o sistema, e o sistema hoje não tem redundância geoespacial, tem duas tabelas.

Quatro consequências verificadas, não deduzidas:

- **O bruto arquivado é uma conclusão.** Conteúdo real de `/var/lib/cpr-bruto/3c051c17….json`, apontado por `ops.leitura_fonte.bruto_uri`:
  ```json
  { "fonte": "PRODES", "chave": "TALHAO/17fedc22-…",
    "resultado": { "resultado": "CONFORME", "area_sobreposta_ha": 0 },
    "consultado_em": "2026-09-19T11:05:40.205Z" }
  ```
  Sem versão de base, sem `hash_dataset`, sem versão de polígono, sem data de corte, sem os IDs das feições que intersectaram, sem margem. "De onde veio este número" responde: "alguém disse CONFORME". `060_oraculos.sql:89-91` afirma que sem o payload cru a leitura não é reproduzível (P6) — está certo, e é o que acontece.
- **A chave não carrega versão de polígono.** `chave = TALHAO/<id>` (`eudr.service.ts:67`), janela de validade de 90 dias. Uma leitura coletada para o polígono v1 permanece vigente para o v2. Já há deriva na base: a evidência `e65ae12c` de `abbcbeaf` registra `poligono_versao = 1` enquanto `geo.talhao_geometria` está em `versao = 2`.
- **`geoPorChave` é um `Map` de módulo sem TTL e sem remoção** (`fontes.ts:76-80`). Valor publicado uma vez fica para sempre, e `lerGeo` carimba `consultado_em: new Date()` sobre ele — a linhagem afirma frescor que não tem.
- **O status do POST é descartado.** `chamar` (`packages/nucleo/src/cliente.ts:29-38`) não checa `response.ok`, e `eudr.service.ts:86` faz `await chamar(...)` sem olhar o retorno. POST que falhe com 401/422/500 é silencioso, e a coleta seguinte serve o valor antigo do `Map` como se fosse leitura nova.

Ainda: `fonte: b.codigo === 'MAPBIOMAS' ? 'MAPBIOMAS' : 'PRODES'` (`eudr.service.ts:88`) — **qualquer terceira base é publicada sob o rótulo `PRODES`**, sobrescrevendo o resultado real do PRODES. Cadastrar `GFW_INTEGRATED` em `base_referencia_geo` faz o veredito do PRODES desaparecer sem erro.

---

## ALTA

### A1. `/evidencias/{id}/reproducao` é parcialmente tautológica e não fixa versão de nada
`services/eudr/src/eudr.service.ts:167-197`; contrato em `docs/contracts/openapi/eudr.yaml:108-112`

O OpenAPI promete: *"reprocessa a mesma versão de polígono contra a mesma versão de base e compara o hash"*. O código não faz nenhuma das duas coisas:
- rebusca bases por `DISTINCT ON (codigo) … ORDER BY codigo, versao DESC` (`:171-172`) — a versão **corrente**, não a da evidência;
- `cruzarBase` toma `geo.talhao_geometria … ORDER BY versao DESC LIMIT 1` (`:38-39`) — o polígono **corrente**;
- no payload do hash (`:185-187`) reaproveita **`original.poligono_hash`, `original.poligono_versao` e `original.resultado`**, lidos da própria linha que se quer verificar.

Logo, o veredito — que é o que a evidência afirma, e que vem do quórum do oráculo — **nunca é recomputado**. A rota não reexecuta o oráculo em momento algum. Ela verifica que `hash_evidencia` é um checksum consistente dos campos gravados, não que a decisão decorra dos insumos.

Execução ao vivo sobre a evidência `e65ae12c` (polígono v1 na evidência, v2 na base):
```
REPRODUCAO: { "reproduzivel": false,
  "divergencias": ["hash divergente: original 0xb471d0aa…, reproduzido 0xb3e4743b…"] }
```
Diz "não reproduzível" pelo motivo errado, e a mensagem não informa o que de fato aconteceu — que a reprodução cruzou o polígono v2 e carimbou o hash do v1. Reprodução histórica é impossível: as versões antigas de base existem em `base_referencia_geo`, e nenhum caminho de código as alcança.

**Correção:** resolver polígono e base pelas versões gravadas na evidência, recomputar `resultado` inclusive o quórum, e reportar divergência campo a campo.

### A2. A ofuscação de centroide é reversível — deslocamento de módulo fixo, resorteado a cada reingestão
`services/eudr/src/geo.service.ts:100-108`; `docs/contracts/db/ops/030_produtor_e_talhao.sql:80-85`

*(Achado coincidente com `docs/panel/G2/e2-privacidade.md` §A3, de E2. Registro por medição própria e porque toca a qualidade do dado geoespacial, não só a privacidade.)*

`const raio = 5000` é constante; só o ângulo é sorteado. Distâncias reais medidas entre `geo.talhao_ofuscado.centroide_aprox` e o centroide verdadeiro, seis registros:

```
4983,22  4988,69  4999,07  4998,21  4985,19  4994,03  (metros)
```

O ponto verdadeiro não está "em algum lugar num disco de 5 km" (≈78,5 km²) — está sobre uma **circunferência** de 31,4 km com banda de ~±17 m (resíduo da conversão plana a 111.320 m/grau). Área efetiva de busca ≈ 1,07 km²: redução de ~73× frente ao disco que o nome e o `CHECK (raio_ruido_m >= 5000)` sugerem. E `raio_ruido_m` é devolvido ao cliente (`geo.service.ts:138`), então o raio não é segredo.

Pior: `ON CONFLICT (talhao_id) DO UPDATE SET centroide_aprox = …` (`:107`) resorteia o ângulo a cada reingestão. Duas publicações reduzem o verdadeiro a dois pontos; três o determinam. O talhão `abbcbeaf` já está em `poligono_versao = 2`. Somado a `metadados()`, que devolve `municipio_ibge` e `area_calculada_ha` com quatro casas (precisão de 1 m²), a reidentificação contra base fundiária é trivial. `Math.random()` também não é CSPRNG.

### A3. `hash_linhagem` não liga insumo a veredito, e o oráculo não tem rota de reprodução
`services/oracle/src/quorum.service.ts:142-146` e `:59-64`; `docs/contracts/db/ops/060_oraculos.sql:64,89-91`

`hashPayload({ chave, politica, fontes:[{fonte,bruto}], falhas })` cobre só a entrada. Não cobre `valor_numerico`/`valor_json`, `fontes_usadas`, `fontes_independentes`, `dispersao_pct` nem `estado`. Um `UPDATE` em `fontes_independentes` mantém `hash_linhagem` válido. O DDL chama o campo de *"hash da árvore de insumos"* — é literalmente isso, e por isso não serve de âncora de integridade da decisão.

Não existe `GET/POST /leituras/:id/reproducao`. A linhagem é legível (`/leituras/:id/linhagem`) e não verificável: nenhum caminho de código recomputa o agregado a partir dos brutos arquivados. O EUDR tem rota de reprodução (ainda que defeituosa, A1); o oráculo não tem nenhuma.

O arquivo bruto também não sustenta a afirmação do contrato congelado (`060_oraculos.sql:89-91`, *"objeto no armazenamento append-only"*): é `writeFileSync` em diretório local (`quorum.service.ts:62`), volume nomeado sem WORM. E `bruto_uri` grava o **caminho do sistema de arquivos do ambiente**: `arquivo:///var/lib/cpr-bruto/<hash>.json` em desenvolvimento, `/bruto` no compose (`infra/compose/docker-compose.yml:182`), `/tmp/cpr-bruto` no CI (`.github/workflows/ci.yml:96`). O ponteiro de linhagem gravado no banco não resolve fora da máquina que o escreveu, e no CI aponta para diretório apagado a cada execução. O nome do arquivo já é o hash: a URI só acrescenta acoplamento de ambiente.

### A4. A contagem de independentes desconta correlação; a **agregação** não — o republicador controla a mediana
`services/oracle/src/quorum.service.ts:98-111`

`numericas` inclui **todas** as fontes coletadas, inclusive as correlacionadas. Com `AGREGADOR_X` republicando o CEPEA byte a byte (`infra/dados/massa.mjs:153`: `AGREGADOR_X: Number(preco.toFixed(2))`, idêntico a `CEPEA`), o valor do CEPEA entra duas vezes na ordenação:

- 3 fontes `{CEPEA=X, AGREGADOR_X=X, B3=Y}` → mediana = **X**, sempre.
- 4 fontes `{Z, X, X, Y}` com `Z < X < Y` → mediana = média dos dois centrais = **X**.

O CEPEA fixa a mediana em ambos os casos. O quórum foi deduplicado e o número não. Uma fonte declarada como não independente — e portanto reconhecida como não acrescentando informação — acrescenta **peso decisório**. O caso C2 do aceite grava exatamente essa configuração (`estado=EFETIVA independentes=2`, 3 fontes) e não olha para o valor.

Pelo mesmo caminho, `peso` (0,5 para o `AGREGADOR_X`) é coluna morta: `MEDIA_PONDERADA` está implementada como média aritmética simples (`:109`).

### A5. O caminho de disputa é porta de mão única, e nunca foi exercido
`services/oracle/src/app.controller.ts:70-97`; `docs/contracts/db/ops/060_oraculos.sql:94-106`

P4 exige *"caminho de disputa"*. `POST /leituras/:id/disputas` insere a disputa e faz `UPDATE … SET estado = 'EM_DISPUTA'`. Não existe, em `services/`, **nenhum escritor** de `disputa_leitura.resolucao`, `leitura_substituta_id`, `resolvida_em` ou `resolvida_por` (grep por `MANTIDA|SUBSTITUIDA|INVALIDADA` em `services/`: zero ocorrências). Uma leitura que entra em `EM_DISPUTA` nunca sai: `efetiva()` filtra `estado IN ('EFETIVA','DEGRADADA')` (`quorum.service.ts:235`), então abrir disputa inutiliza permanentemente a leitura, sem substituta e sem reexame.

`SELECT count(*) FROM ops.disputa_leitura` → **0**. Nenhum roteiro de aceite abre disputa. O caminho de disputa não foi verificado por ninguém, inclusive por quem o escreveu.

Nota menor no mesmo bloco: o evento `oraculo.disputa-aberta` carrega `hash: '0x' + '0'.repeat(64)` (`:92`) — evidência de hash zero, sob P5, não é evidência.

---

## MÉDIA

### M1. `margem_erro_m` é gravado como literal `30`, não como a resolução realmente usada
`services/eudr/src/eudr.service.ts:119` e `:144` — o `INSERT` passa `30` fixo, e o retorno da API também. A resolução real vem de `b.resolucao_m` e varia por base (`070_eudr.sql:17`). Hoje as duas bases usam 30, então o erro é invisível; uma base de 250 m produziria `LIMITROFE` com faixa calculada a 250 e evidência declarando 30. Além disso, o campo guarda a **resolução**, enquanto a margem que decide está em hectares e só existe dentro do jsonb `bases[]`. A `CONSTRAINT limitrofe_tem_margem CHECK (margem_erro_m > 0)` (`070_eudr.sql:55`) é satisfeita pelo literal — ela não prova nada.

### M2. A dispersão nunca é calculada no ramo JSON: `desvio_max_pct` do GEOESPACIAL é configuração morta
`services/oracle/src/quorum.service.ts:121-138` — `dispersao` só é atribuída no ramo numérico (`:111`). Estado vivo: `dispersao_pct` é `NULL` nas **32** leituras `GEOESPACIAL`. A política declara `desvio_max_pct = 5.0000` para GEOESPACIAL (`060_oraculos.sql:41`) e esse número nunca foi consultado. Duas bases que divergissem em ordem de grandeza na área sobreposta não acionariam nada — só o "pior resultado" da `INTERSECAO`, que esconde a discordância em vez de sinalizá-la.

No ramo numérico o mecanismo existe mas nunca disparou: das 6 leituras `PRECO` em `SEM_QUORUM`, **todas** têm `dispersao_pct` nulo, isto é, vieram da falta de independentes (C3 do aceite), não de dispersão. Máxima dispersão observada em 24 leituras efetivas: 1,53% contra tolerância de 2,0%. O ramo de `:112-115` nunca executou neste ambiente.

### M3. Os casos-limite da massa sintética não são limite
`infra/dados/massa.mjs:116-125`

O caso `LIMITROFE` posiciona uma faixa de ~9 m de sobreposição. Medido na base: **0,3828 ha contra margem de 2,68 ha** — fator 7 de folga. Não testa a fronteira do classificador; testa que sobreposição pequena não vira `NAO_CONFORME`. O caso `NAO_CONFORME` mede 1,993 ha contra margem 1,34 ha (fator 1,49) — esse, por acidente, está mais perto da fronteira que o caso desenhado para estar nela. **Não existe caso com `area ≈ margem`**, que é onde a classificação flipa.

Lacunas estruturais da massa, todas verificadas:
- nenhuma geometria inválida — `poligonoQuadrado` é sempre válido, e o caminho de recusa de `geo.service.ts:64` nunca é exercitado pela massa; `motivo_invalidez` em `geo.talhao_geometria` nunca é preenchido (o que foi **descartado** não fica registrado: geometria recusada é exceção HTTP, não linha de linhagem);
- nenhum caso de divergência área declarada × calculada perto dos 20% — e `infra/demo/executar.mjs:73` passa `area_estimada_ha` **como** `area_declarada_ha`, garantindo divergência ~0 e tornando `area_coerente` (`030_produtor_e_talhao.sql:48-51`) estruturalmente inatingível na demonstração;
- nenhum caso de talhões sobrepostos entre produtores distintos — o defeito C3 existe na base viva sem que a massa o modele;
- `perfil_esperado` é asserção do gerador, nunca conferida: talhões `CONFORME` são sorteados em ±0,6° e podem cair sobre DESM-001/002 por acaso.

### M4. O aceite de oráculo não toca as três coisas que mais importam neste portão
`infra/demo/aceite-oraculo.mjs` (24 casos) / `docs/panel/G2/evidencia/aceite-oraculo.txt` (24/24)

Ausências, por confronto entre o roteiro e as políticas de `060_oraculos.sql:38-45`:
- **Nenhum caso `GEOESPACIAL`.** A agregação `INTERSECAO`, o veredito `LIMITROFE`, a publicação por serviço externo e todo o motor que produz o selo do colateral estão fora do aceite de quórum. É o tipo de leitura com `criticidade = CONTRATUAL` e zero cobertura.
- **Nenhum caso `DEGRADADA`.** É o estado que o SMC-002 identifica como "a porta dos fundos de P4" e que os dois gatilhos (`tg_valida_uso_leitura`, `tg_valida_quorum_leitura`) existem para fechar. Alcançá-lo é trivial — derrubar `COOP_SUL` e `AGREGADOR_X` deixa 2 fontes e 2 independentes contra `min_fontes = 3` — e ninguém o fez. Os dois gatilhos nunca foram executados contra o caso que motivou sua escrita.
- **Nenhum caso de dispersão** e **nenhum caso de disputa** (ver M2, A5).
- Nenhum caso que exercite o defeito de C4: correlação em cadeia, bidirecional, ou com a primária caída.

### M5. C4 afirma uma assimetria que a implementação não tem; C9 tem assertiva vacuamente verdadeira
`infra/demo/aceite-oraculo.mjs:63-67` e `:136-142`

**C4** — `'C4 derrubar o agregador custa menos que derrubar a fonte primária'` — derruba apenas o `AGREGADOR_X` e assere `EFETIVA`. O contrafactual (derrubar o CEPEA e manter o agregador) **não é executado**. E, pela implementação, a assimetria não existe: com o CEPEA fora, `correlacao.get('AGREGADOR_X') = ['CEPEA']` não encontra o CEPEA entre as usadas, o agregador forma grupo próprio e o resultado é igualmente 3 fontes / 3 independentes / `EFETIVA`. O caso passa; a afirmação do seu nome é falsa. Pior: o cenário real — a primária cai e o republicador continua servindo o boletim de ontem — é precisamente `X,Y => 2` de C4-crítica, e o sistema o trata como redundância plena.

**C9** — `linhagemSemUrl.descartadas.every(d => /parse URL/i.test(d.motivo_descarte ?? ''))`: `Array.prototype.every` sobre lista vazia é `true`. A assertiva passa se não houver nenhuma descartada. Soma-se a isso que o caso registra `fontes=0` na evidência (`aceite-oraculo.txt` linha 27) — exatamente o defeito que o comentário de `:91-95` diz ter sido corrigido nos casos C7 pela introdução de controle: *"passava com `fontes=0`, ou seja, provando que nada funcionava"*. C9 não ganhou controle próprio. E o caso consagra como comportamento esperado uma divergência de ambiente conhecida (achado G2-A3-01), o que o torna um teste que trava o bug no lugar em vez de sinalizá-lo.

---

## BAIXA

### B1. `topologia_valida: true` é literal, não leitura
`services/eudr/src/geo.service.ts:115` e `:139`; `:94` insere `valido_topo` com o literal `true`. Na ingestão a validação de fato ocorreu (`:64` recusa antes), então não é mentira hoje — mas `metadados()` devolve `true` para qualquer talhão, inclusive um cuja geometria tenha sido inserida por outro caminho, e `geo.talhao_geometria.valido_topo`/`motivo_invalidez` são colunas que só podem receber `true`/`NULL`.

### B2. As bases externas não passam por validação topológica; os polígonos dos produtores passam
`docs/contracts/db/ops/070_eudr.sql:26-33` (sem `valido_topo`) e `services/eudr/src/geo.service.ts:26-31` (sem `ST_IsValid`). A assimetria contradiz o princípio que o próprio repositório escreve em `030_produtor_e_talhao.sql:53-56` (*"E5 trata dado externo como suspeito por padrão"*): o dado do produtor é auditado, o dado da fonte externa é confiado. Polígono de base autointersectante produz área de interseção ambígua ou `TopologyException`. As 3 feições atuais são válidas (verificado) — a ausência de controle é que fica. Some-se `ON CONFLICT (base_id, id) DO NOTHING` em `geo.service.ts:29`: feição corrigida numa republicação da mesma versão é silenciosamente ignorada.

### B3. `independente_de` é `text[]` sem integridade referencial nem simetria
`docs/contracts/db/ops/060_oraculos.sql:14`. Não há FK para `fonte_oraculo.codigo`, nem CHECK, nem gatilho de simetria. Um erro de digitação (`'CEPEA '`, `'cepea'`) torna a fonte silenciosamente "independente" e infla o quórum sem erro em lugar nenhum. O campo que carrega a defesa de P4 é uma lista de strings livres.

### B4. `poligono_hash` não é canônico, apesar de o contrato dizer que é
`services/eudr/src/geo.service.ts:61` usa `digest(ST_AsBinary(ST_ReducePrecision(geom, 0.000001)))`. `ST_AsBinary` preserva ordem de vértices, orientação de anéis e ordem dos polígonos no multipolígono — não há `ST_Normalize`. `030_produtor_e_talhao.sql:44` descreve o campo como *"hash do polígono canonicalizado"*. O mesmo talhão reenviado com vértice inicial deslocado produz hash diferente. Hoje é inconsequente porque ninguém compara hashes de polígono; passa a ser consequente no instante em que C3 for corrigido por deduplicação de hash.

### B5. O ramo numérico ignora a agregação declarada
`services/oracle/src/quorum.service.ts:107-109`: se houver qualquer valor numérico, a política cai em `MEDIANA` ou média aritmética, independentemente de `agregacao` ser `UNANIMIDADE` ou `INTERSECAO`. `REGISTRO`, `PAGAMENTO` e `FISCAL` são `UNANIMIDADE`; se um adaptador passar a devolver `valorNumerico`, a unanimidade vira média sem aviso. O `desvio_max_pct = 0.0000` dessas políticas mascara o problema por coincidência aritmética, não por desenho.

---

## O que NÃO consegui verificar

- **Resolução, cobertura e erro de georreferenciamento reais de PRODES, MapBiomas e GFW.** Não consultei nenhuma fonte externa nesta sessão. Todo `resolucao_m = 30` deste parecer vem de `infra/db/referencia.sql:28-29`, que o próprio repositório marca `[#REF]` como valor a confirmar. **Sem isso, a defensabilidade da margem não é avaliável em absoluto** — avaliei a *forma* da margem (unidimensional, unilateral, escalada pelo perímetro do talhão), não o seu *valor*. [#REF]
- **Data de corte do Regulamento (UE) 2023/1115 e os adiamentos** citados em `eudr.service.ts:10-14` (Regulamento (UE) 2025/2650, 30/12/2026 e 30/06/2027). Não confirmei. [#REF]
- **A margem `perímetro × resolução/2` contra literatura de propagação de erro em cruzamento vetor-raster.** Dimensionalmente é coerente (m × m → m² → ha) e a intuição "o erro mora nas bordas" é correta. Mas medi que ela escala com o perímetro do **talhão inteiro**, e não com o comprimento da fronteira **compartilhada** com o polígono de desmatamento: um desmatamento inteiramente interior ao talhão não tem borda em comum e ainda assim recebe a margem cheia. Na base viva isso resulta em margens de **13,4% a 26,9% da área do talhão** (mín. 1,34 ha sobre 4,98 ha; máx. 2,68 ha sobre 19,93 ha). Para talhão alongado a margem pode superar a área total, tornando `NAO_CONFORME` inalcançável. Não confirmei se existe formulação consagrada preferível. [#REF]
- **Se a triplicação de polígono (C3) tem análogo legítimo** — condomínio, arrendamento, sucessão — que exija sobreposição permitida. Tratei como defeito porque não há exceção declarada em lugar nenhum e porque a origem no `executar.mjs` é claramente acidental.
- **`ops.evidencia_eudr.evidencia_uri`** (`evidencia://eudr/<16 hex>`): não verifiquei se existe armazenamento por trás. O prefixo sugere que não.
- **Cadeia, `services/core` e o consumo do selo `LIMITROFE`.** Fora do escopo. Registro que `eudr.service.ts:127-130` propaga `resultado` para `ops.contrato.selo_eudr` sem filtro, e que não conferi como o núcleo trata um selo `LIMITROFE` em gatilho de LTV ou excussão.
- **Os talhões `QUASE-ENCOSTA-5m`, `SOBREP-40pct-5ha` e `LIMITROFE-massa`** existem na base viva mas **não estão em nenhum arquivo do repositório** (`grep` em toda a árvore: zero ocorrências). São estado de banco sem script de origem versionado — não reprodutíveis a partir do repositório, e portanto não são evidência de portão.

---

## O que está bem feito — conferido

- **`contratual_exige_redundancia`** (`060_oraculos.sql:32-33`) é o tipo de invariante que deveria ser mais comum: torna impossível *configurar* leitura contratual de fonte única. Não é verificação em tempo de execução, é impossibilidade estrutural.
- **`tg_valida_uso_leitura` e `tg_valida_quorum_leitura`** (`060_oraculos.sql:118-183`) checam quórum na origem e no consumo, incluindo o caso `DEGRADADA` que o SMC-002 identificou. A lógica está correta para o que testa — o defeito é que nunca foi exercitada (M4), não que esteja errada. O comentário `:132-135` explicando *por que* o ramo `DEGRADADA` era a porta dos fundos é documentação de primeira ordem.
- **A separação `ops.talhao` / `geo.talhao_geometria` / `geo.talhao_ofuscado`** em schemas com papel próprio, com o hash sendo a única coisa que atravessa para on-chain, é o desenho certo. `metadados()` nunca devolve geometria bruta e `geometria()` exige finalidade declarada e registra o acesso (`geo.service.ts:144-153`, `app.controller.ts:59-70`).
- **Recusar geometria inválida em vez de "corrigir"** (`geo.service.ts:64`), com o raciocínio explícito de que `ST_MakeValid` silencioso produz área errada e área errada vira colateral errado. Está certo.
- **Cruzamento no PostGIS, não em memória**, com a justificativa correta em `070_eudr.sql:23-25` e `geo.service.ts:9-11`.
- **`ST_Area(geom::geography)`** — área geodésica, não planar em graus. Correto, e é um erro comum que aqui não foi cometido.
- **`resolucao_m` e `data_corte` como colunas e não constantes** (`070_eudr.sql:11,17`), com o motivo escrito: o regulamento já foi adiado. O defeito de M1 é o código não honrar a coluna, não a modelagem.
- **`politica_snapshot jsonb`** em `leitura_oraculo` (`060_oraculos.sql:63`) — guardar a política vigente *no momento*, e não a referência à política, é exatamente o que P6 exige.
- **Fonte que falhou vira linha de linhagem** (`quorum.service.ts:169-180`), com `descartada` e `motivo_descarte`, e `/linhagem` devolve usadas e descartadas separadas. Para preço e registro a linhagem responde de fato o que foi ignorado e por quê. O caso C9 prova que o motivo gravado é a causa real (`Failed to parse URL from …`) e não um genérico "fonte caiu". É o melhor pedaço de linhagem do sistema — e contrasta com a ausência total do equivalente no geoespacial (C5) e na geometria recusada (M3).
- **`efetiva()` devolve idade do dado e estado corrente das fontes** (`quorum.service.ts:229-253`), distinguindo "vigente na janela" de "as fontes estão de pé agora", com aviso textual. A prociclicidade fica à vista de quem decide em vez de escondida. Os casos C5 provam isso.
- **`degradacao()` reporta independentes e não brutas** (`:292`), com o raciocínio correto: repetir a contagem bruta no painel de saúde seria reproduzir no monitoramento a redundância aparente que a política recusa. O defeito de C4-crítica atinge o número, não a decisão de qual número exibir.
- **`SMC-011`** (`060_oraculos.sql:193-198`): trocar `ops.pct` por `numeric(10,4)` em `ltv_pct` porque o tipo tornava irrepresentável justamente o caso perigoso. Raciocínio exemplar sobre esquema que esconde risco em nome de higiene de tipo.
- **O aceite ganhou casos de CONTROLE** (`aceite-oraculo.mjs:89-95`) depois de descobrir que passava com `fontes=0`. A autocrítica está escrita no roteiro. É a razão pela qual M5 aponta que C9 ficou de fora da correção — e não que a correção não tenha sido feita.
- **ADR-0006** estabelece o padrão certo: declarar as premissas do simulador porque *"o simulador não é neutro: ele define o que é possível detectar"*, e reportar detecção *sob premissa PRn*. Registro que esse padrão **não foi aplicado ao simulador geoespacial**, que é o mais carregado dos dois: três quadrados sintéticos como bases de desmatamento e duas "fontes independentes" que são o mesmo motor. Não existe ADR declarando essas premissas, e por ADR-0006 deveria existir.
- **ADR-0003** antecipa corretamente a redundância aparente e marca `[#REF]` a parametrização não fundamentada. O critério de revisão nº 4 — *"evidência de correlação oculta entre fontes declaradas independentes"* — é a pergunta certa. O achado C4-crítica é que o mecanismo escolhido para respondê-la não funciona.
