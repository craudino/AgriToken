# Parecer E2 — Privacidade e Proteção de Dados — Portão G2

> Parecer emitido com contexto isolado sobre o HEAD `162f48e`, em 2026-09-19.
> Reproduzido íntegro, sem edição do orquestrador. As verificações que o
> orquestrador reproduziu de forma independente estão anotadas no dossiê.

**Veredicto: REPROVA**

Pergunta-guia: *se precisarmos eliminar este titular amanhã, conseguimos?* **Não.** Duas
estruturas sobrevivem intactas à "eliminação" e reidentificam o titular: o índice cego
`documento_hmac`, protegido por uma chave única compartilhada por todos os titulares, e o
polígono georreferenciado bruto, que o próprio DDL classifica como reidentificante e que
nenhuma linha do caminho de eliminação toca. O crypto-shredding destrói a chave AES do
titular e não destrói a capacidade de reidentificá-lo. A afirmação central do ADR-0002 —
"a eliminação do titular é executada por crypto-shredding" — não se sustenta no código.

O padrão de G1 (garantia que mora no comentário) se repete e foi confirmado por execução,
não por leitura: rodei `validar:eventos` e `validar:contratos` (ambos verdes), mutei a
interface congelada e provei que o teste de P2 aprova um evento com `string cpf`.

---

## CRÍTICA

### C1 — O índice cego sobrevive à eliminação e é chave compartilhada entre todos os titulares
`docs/contracts/db/pii/010_titular_e_chaves.sql:35` · `packages/nucleo/src/canonico.ts:34-35` ·
`services/compliance/src/cofre.service.ts:24,31` · `services/compliance/src/eliminacao.service.ts:49-63`

`pii.titular.documento_hmac` é `bytea NOT NULL UNIQUE` = HMAC-SHA256(CPF normalizado) sob
`CHAVE_INDICE_CEGO`. A transação de eliminação (linhas 49-63) grava `destruida_em`,
`destruicao_ref` e `eliminado_em`. **Não apaga, não anula e não rotaciona `documento_hmac`.**
A coluna é `NOT NULL`, então anulá-la também não é possível sem mudança de DDL congelado.

A chave é uma só, de serviço, lida de `process.env.CHAVE_INDICE_CEGO ?? 'dev'`
(`cofre.service.ts:24`), idêntica para todos os titulares. É exatamente a chave
compartilhada que o comentário de `010_titular_e_chaves.sql:16-18` diz que o projeto evita
— só que ela está na outra coluna. Destruí-la para eliminar um titular destrói o índice de
todos; não destruí-la deixa todos os eliminados reidentificáveis.

Com a base e a chave (env var, nunca rotacionada por titular, nunca destruída), recomputar
HMAC sobre o espaço de CPFs válidos reidentifica **todo titular já eliminado**. É o ataque
de dicionário que o ADR-0002:23-27 declara rejeitar — reintroduzido, com um passo a mais.
O ADR diz "quem publica hash(CPF) publicou o CPF"; a base guarda HMAC(CPF) com chave única
e sobrevivente, e chama isso de eliminado.

**Por que importa:** o comprovante de irreversibilidade emitido ao titular e ao regulador
afirma algo falso. O sistema não consegue responder "sim" à pergunta do art. 18, VI.

**Correção proposta:** a chave do índice cego tem de ser por titular (derivada da chave do
titular no KMS) ou o `documento_hmac` tem de ser destruído na eliminação — o que exige
mudança de contrato congelado (`NOT NULL`) e uma estratégia alternativa de idempotência
para reonboarding.

### C2 — O polígono bruto não é alcançado pelo crypto-shredding e não tem prazo de retenção
`docs/contracts/db/ops/030_produtor_e_talhao.sql:63-77` · `services/eudr/src/geo.service.ts:92-96` ·
`services/compliance/src/eliminacao.service.ts:23-81`

`geo.talhao_geometria` guarda o `MultiPolygon` em claro, **na base `cpr_ops`** (é `poolOps()`
em `geo.service.ts:92`), não no cofre. Não é cifrado com a chave do titular; não é cifrado
de forma alguma. O comentário do DDL (linhas 74-77) o declara "dado potencialmente
reidentificante" e garante apenas que não vai on-chain — cala sobre eliminação.

`EliminacaoService.eliminar` toca `pii.chave_titular`, `pii.titular`,
`pii.pedido_eliminacao`, `pii.operacao_tratamento` e `ops.produtor`. **Nenhuma referência a
`geo.talhao_geometria`** (confirmado por varredura: as únicas referências ao schema `geo`
em `services/` estão em `eudr`). Depois da eliminação, o contorno exato da lavoura do
titular permanece na base, indefinidamente, ligado a `ops.talhao.produtor_id` →
`ops.produtor` (linha preservada por desenho, `030:23-26`).

**Por que importa:** o polígono de um talhão de café é o identificador mais forte do
sistema — cruzá-lo com o SICAR público reidentifica o proprietário sem passar pelo cofre.
`retencaoObrigatoria` (`eliminacao.service.ts:14-21`) sequer lista a geometria entre o que
permanece, então o titular recebe uma resposta incompleta sobre o que ficou.

**Correção proposta:** decidir explicitamente — geometria cifrada sob a chave do titular
(entra no shredding) ou eliminação/degradação da geometria no pedido, com o que permanecer
declarado em `retencao_obrigatoria` com fundamento e prazo.

---

## ALTA

### A1 — `validar:contratos` aprova PII em evento: o teste de P2 não olha eventos, nem `bytes`, nem `contracts/src/`
`infra/ci/validar-abis.mjs:17,71-77,113-115`

Mutação executada nesta sessão: injetei em `contracts/interfaces/IRegistroParticipantes.sol`

```solidity
event TitularCadastrado(address indexed conta, string nomeCompleto, string cpf);
function anotar(address conta, bytes calldata dossie) external;
```

Saída do CI:

```
OK  P2: nenhuma função mutante recebe texto livre
```

O build só falhou por `[P6] ... divergiu da interface Solidity` — controle de mudança, não
controle de PII. E `--gerar` (linha 113-115, oferecido pelo próprio script para "mudança de
contrato") pula o P6 inteiro: o fluxo documentado de alteração de contrato embarca o evento
com `string cpf` e o CI diz "OK P2". Três lacunas, todas no mesmo `if`:

- linha 71: `if (item.type === 'function' && ...)` — **eventos nunca são inspecionados**, e
  evento é precisamente onde PII vaza (topic/data ficam no log para sempre);
- linha 73: só `string` e `string[]` — `bytes`/`bytes[]` passam, e `bytes` carrega qualquer
  coisa;
- linha 17: `FONTES = contracts/interfaces` — `contracts/src/*.sol` nunca é compilado por
  este validador. `EspelhoCPR.sol:47-52` já declara eventos que não existem na interface
  (`TitularidadeAlterada`, `Pausado`) e que, portanto, ninguém verifica.

A varredura de cadeia (`varrer-pii-cadeia.mjs`) não cobre a lacuna: ela examina os 22 blocos
que a demo produziu, não o que o contrato é capaz de emitir. É teste de um caminho, não
prova de uma fronteira. Ela também não alcança: valores numéricos (CPF como `uint256` não é
ASCII), coordenadas como inteiros escalados (`lat*1e6`), nomes com acento (o extrator quebra
runs em bytes > 0x7e), storage (`eth_getStorageAt`) e qualquer codificação não-ASCII.

### A2 — A trilha append-only tem o filtro de PII mais fraco do sistema e aceita CPF sem pontuação
`docs/contracts/db/audit/010_registro_auditoria.sql:20-25` · `docs/contracts/db/testes/conformidade_audit.sql:38-42`

O CHECK exige pontuação literal: `[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}`. Verificado por
execução do regex: **`{"documento":"52998224725"}` passa.** Não há CHECK de CNPJ, telefone,
coordenada, nome ou endereço.

Compare com `ops.texto_sem_pii` (`020_dominios_e_enums.sql:10-12`), que usa `\.?` e `-?` e
bloqueia CPF sem pontuação, e tem regra de CNPJ. O gradiente está invertido: a tabela de
onde *é possível* apagar tem o filtro forte; a tabela **append-only por gatilho, onde apagar
é impossível por construção** (`010:71-83`), tem o filtro fraco.

O teste de conformidade (`conformidade_audit.sql:41`) usa `'123.456.789-09'` — testa
exatamente o caso que o CHECK pega e nunca o caso que ele deixa passar. Ele aparece verde em
`validar.txt` como "OK P2: CPF no payload da trilha de auditoria (rejeitado)". Isso é o
teste que passa sem testar o que importa.

**Por que importa:** é o único lugar do sistema onde a tensão imutabilidade × LGPD é
irreversível de verdade, e é onde a defesa é mais fraca. Um CPF sem máscara ali não sai mais.

### A3 — A ofuscação de centroide é um círculo de raio exatamente 5 km, não um disco — e é resamplada a cada reingestão
`services/eudr/src/geo.service.ts:100-108` · `docs/contracts/db/ops/030_produtor_e_talhao.sql:83`

```js
const raio = 5000;                       // constante, não sorteada
const angulo = Math.random() * 2 * Math.PI;
```

O deslocamento tem módulo fixo. O centroide verdadeiro não está "em algum lugar num disco
de 5 km" (≈78,5 km² de incerteza) — está **sobre uma circunferência de 31,4 km**, um lugar
geométrico unidimensional. E `raio_ruido_m` é devolvido ao cliente (`geo.service.ts:138`),
então o atacante conhece o raio exato.

Pior: a rota de ingestão é `ON CONFLICT (talhao_id) DO UPDATE SET centroide_aprox = ...`
(linha 107) e sorteia um ângulo novo a cada versão do polígono. **Duas observações reduzem o
centroide verdadeiro a dois pontos; três o determinam.** A ofuscação se dissolve com o uso
normal do sistema.

O `CHECK (raio_ruido_m >= 5000)` do DDL valida o valor declarado no campo, não a distribuição
do ruído: se o código gravasse `raio_ruido_m = 5000` e deslocasse 50 m, o CHECK passaria.
A garantia está no comentário ("ruído >= 5 km"), não no controle.

Acessório: `Math.random()` (linha 101) não é CSPRNG.

### A4 — Singularização por combinação exposta a `contrato:ler`, sem registro de tratamento
`services/eudr/src/app.controller.ts:52-58` · `services/eudr/src/geo.service.ts:133-140` · `packages/nucleo/src/auth.ts:36`

`GET /talhoes/:id` exige apenas `contrato:ler` — escopo que o perfil **`credor`** possui
(`auth.ts:36`). A resposta devolve, junto: `produtor_ref`, `municipio_ibge`,
`area_declarada_ha`, `area_calculada_ha`, `commodity`, `apelido` e `centroide_ofuscado`.

Município + área de lavoura + commodity é combinação singularizante num município rural
brasileiro típico — poucos produtores de café arábica com N hectares num município. Somada
ao círculo de A3 e ao `apelido` (texto livre sob `ops.texto_sem_pii`, que não bloqueia nome
de pessoa: "Sítio do Seu Antônio" passa nos três CHECKs), reidentifica.

Nenhuma dessas leituras gera linha em `pii.operacao_tratamento`. O contrato OpenAPI de
compliance afirma "todo acesso a texto claro gera registro de tratamento"
(`docs/contracts/openapi/compliance.yaml:8-10`); esta rota não passa por compliance e não
registra nada.

### A5 — ROPA decorativa: só 2 das 5 operações são registradas; o compartilhamento com terceiros não gera registro
`docs/contracts/db/pii/020_tratamento_e_eliminacao.sql:21,26-32` · `services/compliance/src/cofre.service.ts:74-84` · `services/eudr/src/geo.service.ts:149-152`

`registrarTratamento` é chamado em exatamente dois pontos de todo o repositório
(varredura sobre `services/*/src`): `COLETA` no onboarding e `ELIMINACAO`. Não existe uma
única gravação de `ACESSO`, `USO` ou `COMPARTILHAMENTO`.

O caso mais grave é o compartilhamento real: `executarKyc` (`cofre.service.ts:78,84`) passa
`e.documento` (**CPF em claro**) e `e.car_numero` a `consultarListas` e `verificarCar` —
transferência de dado identificável a terceiro — e não grava nada. O CHECK
`compartilhamento_tem_destinatario` (`020:26-27`) existe e nunca é exercido, porque nenhum
código insere `COMPARTILHAMENTO`.

O comentário em `020:30-32` diz: "Todo acesso a texto claro passa por aqui. Se o registro de
acesso for opcional, ele não existe quando o regulador pergunta." O comentário está certo e
descreve o sistema que não foi construído.

Caso relacionado: a rota de geometria bruta se anuncia como "rota de operador, com
finalidade declarada e registro" (`geo.service.ts:143`). O que ela grava é um INSERT em
`ops.custo_verificacao` (linhas 149-152) — tabela de **custo**, que não guarda quem acessou
nem a finalidade. A `finalidade` é exigida no controller, devolvida no corpo da resposta e
**descartada**. Não há registro de tratamento de acesso a dado geoespacial em lugar nenhum.

---

## MÉDIA

### M1 — A "verificação de irreversibilidade" não prova irreversibilidade
`services/compliance/src/eliminacao.service.ts:39-46`

```ts
let verificacao = 'SUCESSO_INESPERADO';
try {
  const { rows: r } = await poolPii().query(...);
  this.cofre.kmsLocal.decifrar(kmsRef, r[0].nome_cif);
} catch { verificacao = 'FALHOU_COMO_ESPERADO'; }
```

O `catch` é cego. Erro de conexão, `r` vazio (`TypeError` em `r[0].nome_cif`), timeout,
permissão negada — tudo vira "FALHOU_COMO_ESPERADO" e é gravado como comprovante em
`pii.pedido_eliminacao.verificacao_irreversibilidade` e devolvido ao titular. O código nunca
chama `kmsLocal.existe(kmsRef)` (método existe, `kms.ts:65-67`, e não é usado em lugar
nenhum) nem distingue a exceção esperada (`chave ${ref} destruída ou inexistente`,
`kms.ts:33`) das demais.

Além disso: `destruir` usa `rmSync` (`kms.ts:61`) sem sobrescrita — unlink em sistema de
arquivos não garante ausência do material; e o `comprovante_kms` é
`sha256(ref‖material‖timestamp)` truncado, **não verificável por um auditor** depois da
destruição, porque o material já não existe para recomputá-lo. É um registro, não uma prova.

### M2 — Credenciais emitidas continuam válidas após a eliminação; a revogação está no DDL e não no código
`services/compliance/src/credenciais.service.ts:31,46` · `docs/contracts/db/pii/010_titular_e_chaves.sql:56`

`verificar()` devolve `revogada: false` **literal, hardcoded** (linha 31). Não consulta
`revogada_em` nem `status_list_index`. O DDL reserva `status_list_index integer --
StatusList2021 para revogação sem correlação` (linha 56) e nada o usa.

`EliminacaoService.eliminar` não revoga credenciais. Uma VC emitida a um terceiro continua
verificando como válida depois de o titular ter sido eliminado.

Correlação adicional: `didSujeito = did:key:${refOpaca}` (linha 46) embute o pseudônimo no
DID, e o DID é persistido em `ops.produtor.did` e circula em VCs a terceiros. O pseudônimo
que deveria ser opaco vira identificador público estável entre contextos.

Acessório de confiabilidade: `generateKeyPairSync` no construtor — a chave de emissão é nova
a cada reinício do processo, então toda VC já emitida deixa de verificar.

### M3 — A atestação on-chain liga `ref_opaca` a um endereço da cadeia, de forma permanente
`services/compliance/src/app.controller.ts:48`

```ts
const atestacao = sha256Hex(`kyc:${corpo.produtor_ref}:${s.valido_ate}`);
```

Esse hash vai on-chain em `habilitar(conta, atestacaoHash, validoAte)`. É função
determinística de (`ref_opaca`, `valido_ate`), e `valido_ate` está no mesmo evento em claro.
Quem conhece uma `ref_opaca` — perfil `credor`, `auditor` ou `produtor` tem `produtor:ler` /
`contrato:ler` e a vê em respostas de API — recomputa o hash e **liga o pseudônimo ao
endereço on-chain**, e daí a todas as transações daquele titular, para sempre.

Não é PII on-chain (P2 está formalmente respeitado), mas é a correlação entre pseudônimos
que o ADR-0002:56-58 se propõe a impedir. E é imune ao crypto-shredding: o vínculo
ref↔endereço permanece na cadeia depois da eliminação.

### M4 — O higienizador de log não cobre a mensagem, nem telefone, nem coordenada, nem nome
`packages/nucleo/src/telemetria.ts:13-17,39-50`

```ts
const linha = { nivel, ts, origem, correlacao_id, mensagem, ...(higienizar(dados)) };
```

Linha 45: `mensagem` entra **crua**. Só `dados` é higienizado. Todo
`log.erro(ctx, \`falha ao validar documento ${doc}\`)` vaza. E `PADROES_PII` (linhas 13-17)
tem três padrões — CPF, CNPJ, e-mail — contra os cinco do varredor de cadeia
(`varrer-pii-cadeia.mjs:15-21`, que inclui telefone e coordenada). Telefone, coordenada,
nome e endereço passam pelo higienizador sem serem tocados. Coordenada em log é
especialmente relevante dado C2/A3.

### M5 — Base legal existe; prazo de retenção não existe no modelo
`docs/contracts/db/pii/020_tratamento_e_eliminacao.sql:3-28` · `services/compliance/src/eliminacao.service.ts:14-21`

`pii.base_legal` tem `codigo`, `descricao`, `fundamento` — **nenhuma coluna de prazo**.
`pii.operacao_tratamento` registra finalidade e base legal — **nenhuma coluna de prazo de
retenção nem de data de descarte**. Não há, no modelo congelado, como responder "até quando
este dado fica".

O único prazo do sistema é `5 * 365 * 86400_000` embutido em
`eliminacao.service.ts:19`, sem dispositivo citado para o *prazo* (o `fundamento` na linha 18
cita o art. 16, I, que autoriza a retenção, mas não fixa cinco anos), e aplicável a uma
única categoria (`REGISTROS_CONTRATUAIS`). Não cobre a geometria (C2), o `documento_hmac`
(C1), o `resultado_kyc`, as credenciais nem a trilha de auditoria — que é justamente o que
permanece.

Nota factual: não localizei no repositório fonte normativa para o prazo de cinco anos. **[#REF]**

---

## BAIXA

### B1 — A cadeia de hash da auditoria não cobre `evidencia`, `ator_ref`, `origem` nem `assinatura`
`docs/contracts/db/audit/010_registro_auditoria.sql:40-47,98-108`

O digest abrange `hash_anterior‖id‖tipo‖sujeito‖ocorrido_em‖payload`. `evidencia`,
`ator_ref`, `origem`, `versao`, `registrado_em` e `assinatura` ficam de fora. O
`verifica_cadeia` devolve "hash divergente: registro alterado ou suprimido" (linha 108) —
afirmação mais forte do que o cálculo sustenta: alteração nesses campos não é detectada.
Os gatilhos de recusa protegem contra o caminho normal, mas um DBA com `ALTER TABLE ...
DISABLE TRIGGER` edita `evidencia` e `ator_ref` sem quebrar a cadeia.

### B2 — `car_hash` documenta um sal que não existe em lugar nenhum do código
`docs/contracts/db/ops/030_produtor_e_talhao.sql:41` · `services/eudr/src/geo.service.ts:82,89`

O DDL declara `car_hash -- sha256(numero_car normalizado + sal do titular)`. O código faz
`digest($5,'sha256')` sobre `` `car-${talhaoId}` `` — nem o número do CAR, nem sal. Não há
mecanismo de sal por titular em nenhum ponto do repositório. Hoje é inócuo (o valor
hasheado é sintético); no dia em que o CAR real entrar nesse caminho, o hash será
enumerável — o espaço de números de CAR é público e finito, e o DDL reconhece na linha 38
que o CAR "é reidentificante".

### B3 — `validar:eventos` bloqueia nomes de campo ancorados e valores só com pontuação
`infra/ci/validar-eventos.mjs:84,102-106`

O regex `PROIBIDOS` é ancorado (`^...$`). Verificado por execução: passam
`produtor_nome`, `nome_titular`, `cpf_produtor`, `documento_titular`, `contato`,
`chave_pix`, `razao_social`, `lat`, `lon`, `geojson`, `municipio_ibge`, `apelido`,
`centroide`, `coordenada`, `car_ref`. O `REGEX_PII` de valores (linhas 102-106) exige CPF/CNPJ
pontuados e não tem padrão de telefone nem de coordenada: passam `52998224725`,
`11222333000181`, `+5535999990000`, `-21.5234567,-45.4712345`.

A execução hoje é verde (`OK P2: nenhum campo nem exemplo com padrão identificante`) porque
os payloads atuais estão limpos — não porque o teste seja capaz de reprovar a próxima
adição.

---

## O que NÃO consegui verificar

1. **Nada foi verificado em execução com banco de pé.** Não subi `cpr_ops`, `cpr_pii` nem
   `cpr_audit`; não rodei `validar:esquema` (56 verificações) nem `validar:pii-cadeia`.
   Li as saídas em `docs/panel/G2/evidencia/`, mas não as reproduzi. **[#REF]** Rodei
   `validar:eventos` e `validar:contratos` (não precisam de banco), inclusive com mutação.
2. **A eliminação nunca foi executada ponta a ponta.** Não existe teste automatizado do
   `EliminacaoService` no repositório (não localizei arquivo de teste para `services/compliance`).
   Toda a análise de C1, C2 e M1 é por leitura do caminho de execução. Um teste que
   cria titular, elimina e tenta reidentificar via `documento_hmac` provaria ou refutaria C1
   em minutos — e sua ausência é, por si, um achado.
3. **Isolamento de rede entre serviços e `cpr_pii`.** `pii/000_papeis_e_schemas.sql:1-3`
   afirma "nenhum outro serviço tem rota de rede até aqui". Li o `docker-compose.yml` só
   por grep de variáveis; não verifiquei as políticas de rede que sustentariam a afirmação. **[#REF]**
4. **Privilégios efetivos.** `GRANT`/`REVOKE` existem no DDL; não verifiquei quais roles os
   serviços realmente assumem em runtime, nem se `cpr_pii_auditor` de fato não alcança
   colunas `_cif`.
5. **A superfície web.** `apps/web` referencia `municipio_ibge`, `centroide` e
   `produtor_ref` em `app/produtor/page.tsx`, `app/credor/[id]/page.tsx` e `lib/api.ts`.
   Não auditei o que cada tela renderiza a qual perfil — A4 pode ser mais grave do que
   classifiquei se a tela do credor expuser a combinação sem autenticação forte.
6. **Se `ops.produtor.did` é populado.** A coluna existe e é devolvida por `situacao()`;
   não encontrei o `UPDATE` que a preenche. Se for preenchida com `did:key:${refOpaca}`,
   M2 sobe de severidade.
7. **Conformidade da retenção de 5 anos com prazo legal aplicável a CPR.** Fora da minha
   especialidade e sem fonte no repositório. **[#REF]**

---

## O que está bem feito — conferido no código

- **A fronteira on-chain é real.** Li as cinco implementações em `contracts/src/` e as seis
  interfaces. `grep -n "string" contracts/src/*.sol contracts/interfaces/*.sol` retorna **uma
  única ocorrência, e é num comentário** (`IEspelhoCPR.sol:13`). Toda função mutante trafega
  `bytes32`, `address`, `uint256`. `IRegistroParticipantes` guarda endereço, hash de
  atestação e validade — nenhum campo identificante. P2 está de fato respeitado nos
  contratos que existem hoje; o defeito de A1 é do *guarda*, não do que ele guarda.
- **`novaRefOpaca` é genuinamente aleatória** (`canonico.ts:31`): `randomBytes(16)`, CSPRNG,
  sem derivação de documento. `cofre.service.ts:43` a usa corretamente, com o comentário
  certo. O domínio `ops.ref_opaca` (`020_dominios_e_enums.sql:20-24`) fixa 16 bytes. Nenhuma
  derivação de PII em nenhum caminho que percorri. Este ponto o projeto acertou.
- **Uma chave AES por titular, fora do banco.** `pii.chave_titular` é PK por `titular_id`,
  `kms_key_ref UNIQUE`, e `KmsLocal` grava um arquivo por referência com modo `0600` em
  diretório `0700` (`kms.ts:18,27`). A chave de cifragem não está na base de PII — o desenho
  está certo, e o CHECK `destruicao_tem_comprovante` (`010:13-14`) impede marcar destruição
  sem comprovante. O defeito de C1 está numa *segunda* chave que o desenho não tratou como
  chave.
- **Recusa por omissão na autorização.** `GuardaEscopo.canActivate` (`guarda.ts:36-41`)
  devolve 403 a qualquer rota sem `@Escopos` e sem `@Publica`. Verifiquei rota a rota nos
  controllers de compliance e eudr: todas declaram. `geo:bruto` é escopo separado e ausente
  dos perfis `produtor`, `credor` e `auditor` (`auth.ts:35-49`) — a geometria bruta
  realmente não sai por rota de terceiro. O registro é que não acontece (A5).
- **`ops.texto_sem_pii`** (`020_dominios_e_enums.sql:9-12`) é controle preventivo de verdade,
  na base e não no code review, e com o regex mais robusto do repositório (tolera CPF sem
  pontuação, cobre CNPJ). É o padrão que as outras três varreduras deveriam seguir.
- **A trilha de auditoria é append-only por construção**, com três gatilhos
  (`010_registro_auditoria.sql:71-83`) e `REVOKE` explícito, e `validar.txt` mostra os três
  rejeitando UPDATE, DELETE e TRUNCATE. `sujeito_id` e `ator_ref` são documentados como
  opacos e os payloads que inspecionei respeitam isso.
- **O autoteste do detector de varredura** (`varrer-pii-cadeia.mjs:39-59`) é a postura certa:
  prova que detecta antes de afirmar que não achou, e testa falso positivo além de falso
  negativo. O problema é o alcance (A1), não a disciplina.
- **`docs/adr/0002`** identifica corretamente os três caminhos e rejeita os dois errados pelos
  motivos certos, declara o risco residual da âncora determinística de forma honesta
  (linhas 90-95) e marca as próprias afirmações não verificadas com `[#REF]`. A decisão
  está certa; a implementação não a cumpre em C1 e C2.

---

## Razão do veredicto

REPROVA, não "aprova com ressalvas". A diferença não é de contagem de achados: é que C1 e
C2, cada um sozinho, tornam **falsa** a resposta que o sistema dá ao titular e ao regulador.
O endpoint `POST /titulares/:ref/eliminacao` devolve `comprovante_kms` e
`verificacao_irreversibilidade: FALHOU_COMO_ESPERADO` para uma eliminação que deixa
HMAC(CPF) sob chave compartilhada e o polígono da lavoura intactos na base. Emitir
comprovante de irreversibilidade que não é verificado (M1) sobre uma eliminação que não é
irreversível (C1, C2) é pior do que não emitir comprovante nenhum — é a garantia falsa que o
painel rejeitou em G1, agora assinada.

Condições mínimas para reapresentação a E2: C1 e C2 fechados no caminho de execução, com
teste automatizado que crie titular, elimine, e **falhe** se a reidentificação via
`documento_hmac` ou via geometria ainda for possível; A1 com o `if` de P2 estendido a
eventos, a `bytes` e a `contracts/src/`, provado por mutação no CI; A2 com o CHECK da trilha
alinhado ao de `ops.texto_sem_pii` e o teste de conformidade exercitando o CPF sem pontuação.
