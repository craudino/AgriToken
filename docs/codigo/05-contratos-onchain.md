# 5. Contratos on-chain — o que vive na cadeia e por quê

> `contracts/interfaces/` (6 arquivos, **congelados**) e `contracts/src/`
> (5 implementações, 659 linhas). Solidity 0.8.28, Hardhat, 61 testes,
> 100% de linhas e funções, 90% de ramos.

## 5.0 A pergunta anterior a todas

Não é "como tokenizar a CPR". É **"o que precisa estar on-chain para que algo
fique estruturalmente impossível?"** — porque tudo o que não responde a essa
pergunta é melhor servido por um banco de dados.

A resposta do sistema é curta:

| Precisa estar on-chain | Por quê |
|---|---|
| A âncora registro↔token | Unicidade do colateral (P3) tem de ser impossível, não vigiada |
| O estado do espelho | Congelamento tem de valer contra todos, inclusive contra quem opera |
| O registro de habilitados | Circulação fechada tem de ser verificável pela contraparte |
| Os vínculos de garantia | Ordem de preferência tem de ser oponível |

O que **não** está on-chain: nome, CPF, polígono, valor em reais de ninguém,
documento. P2 sem exceções.

E o que não está por outra razão, mais importante: **nenhuma função que altere o
título registrado.**

```solidity
/// @notice O token é representação, nunca fonte de verdade (P1). Não existe
///         aqui função que altere o título registrado — a ausência é parte do
///         contrato, não esquecimento.
```

A ausência é a feature. Um contrato que pudesse "corrigir" o registro
transformaria o token em fonte de verdade, e P1 cairia por completo.

---

## 5.1 As cinco peças

```
ControleAcesso ──────► papéis, timelock nos sensíveis
      ▲
      ├── RegistroParticipantes ──► quem pode receber espelho
      ├── AncoraRegistro ─────────► IMUTÁVEL, sem proxy
      ├── EspelhoCPR ─────────────► ERC-3525, atualizável por UUPS + timelock
      └── CofreGarantias ─────────► vínculos e waterfall, SEM custódia
```

### `AncoraRegistro` — a peça imutável

```solidity
/// @notice Contrato IMUTÁVEL, sem proxy e sem função de atualização, por
///         decisão do ADR-0004: a correspondência título↔token não pode ser
///         reescrita por upgrade, nem por erro nem por má-fé.
```

O espelho é atualizável; a âncora, não. É a assimetria mais importante do
desenho. Se a âncora vivesse atrás de um proxy, **quem controla o proxy poderia
desfazer a unicidade do colateral** — e P3 passaria a ser uma promessa de
governança em vez de uma propriedade estrutural. Garantia que depende de upgrade
não é garantia estrutural.

O preço: um defeito na âncora não tem conserto por upgrade; exige migração
completa. Foi aceito conscientemente no ADR-0004, e é a razão de a âncora ser o
contrato mais simples dos cinco — 56 linhas. Superfície pequena porque não há
segunda chance.

```solidity
uint256 existente = _tokenDaAncora[ancora];
if (existente != 0) revert AncoraJaUtilizada(ancora, existente);
```

**Este `revert` é P3.** Não a validação no backend, que pode ter bug: o
segundo `emitirEspelho` para o mesmo registro reverte, e não há caminho que
contorne.

Detalhe que parece descuido e não é:

```solidity
/// @dev Baixar não libera a âncora para novo espelho: um título baixado não
///      volta a ser espelhável. Liberar reabriria a porta de P3.
```

A tentação de liberar a âncora após a baixa é forte — "o título acabou, o
identificador está livre". Mas um título baixado que volta a ser espelhável é
exatamente o caminho para mobilizar duas vezes a mesma garantia, com um passo
intermediário.

### `ControleAcesso` — e a garantia que morava no comentário

Sete papéis. `ORIGINADOR`, `ESPELHADOR`, `CONCILIADOR`, `RECONCILIADOR_HUMANO`,
`ORACULO`, `PAUSA`, `ADMIN`.

A separação que importa: **quem espelha não concilia, e quem concilia não
reconcilia.** O mesmo processo que detecta a divergência não pode dispensá-la.

```solidity
/// @dev SMC-005: antes, `conceder` era chamada única e imediata e o timelock
///      existia só no NatSpec. O red team apontou em G1 que a garantia estava
///      no comentário, não no código.
```

Este é o achado mais instrutivo de G1. O NatSpec **descrevia** um timelock. A
documentação de arquitetura **prometia** um timelock. `conceder()` concedia o
papel na hora. Todo mundo que leu o código leu o comentário e acreditou.

Hoje papel sensível passa por `propor` → espera → `executarProposta`, com
`cancelarProposta` disponível no meio:

```solidity
function papelSensivel(bytes32 papel) public pure returns (bool) {
    return papel == _ADMIN || papel == _ESPELHADOR || papel == _RECONCILIADOR || papel == _PAUSA;
}
function conceder(bytes32 papel, address conta) external somenteAdmin {
    if (papelSensivel(papel)) revert PapelExigeTimelock(papel);
    …
}
```

`conceder()` **reverte** para papel sensível. Não existe atalho, e o teste
`governanca.test.cjs` verifica que não existe.

A assimetria deliberada:

```solidity
/// @dev Revogação é imediata por desenho. Atrasar a retirada de um papel
///      comprometido protegeria o atacante, não o titular.
```

Conceder é lento, revogar é instantâneo. Timelock existe para dar tempo ao
credor de observar uma mudança que o afeta; aplicá-lo à revogação daria tempo ao
atacante.

### `EspelhoCPR` — ERC-3525 com estado de conciliação

ERC-3525 (*semi-fungible token*) porque a CPR precisa de duas propriedades que
nem ERC-20 nem ERC-721 dão juntas: **identidade** (cada CPR é única, com seu
registro e vencimento) e **fracionabilidade** (o credor cede parte do crédito).
No ERC-3525, o `slot` agrupa tokens da mesma natureza e o `value` fraciona. [#REF]

O que foi acrescentado à norma:

**`EstadoEspelho`** — `ATIVO`, `CONGELADO`, `BAIXADO`, `EXECUTADO`. Congelado não
transfere por nenhum caminho (invariante I3). É P1 valendo contra todos: nem o
titular, nem o operador, nem o admin movem um espelho em divergência.

**`descongelar`** exige `PAPEL_RECONCILIADOR_HUMANO`:

```solidity
/// @dev Só o papel humano de reconciliação descongela. Nenhuma chave de
///      serviço o detém, e não há caminho automático (P1, ADR-0007).
```

**`TitularidadeAlterada`** — o evento que SMC-004 acrescentou:

```solidity
/// @notice A conciliação usa este evento para detectar TRANSFERENCIA_SEM_CESSAO
///         e FRACIONAMENTO_NAO_REFLETIDO (SMC-004): sem ele, a fração
///         circularia fora do registro e o sistema seria cego a isso.
```

O catálogo original de divergências só enxergava o sentido registro → token.
E1 apontou em G1 que a fração pode circular on-chain sem cessão registrada, e a
conciliação não veria. Duas divergências novas, e um evento on-chain para
alimentá-las.

**`modifier semValor`** — toda função `payable` herdada do ERC-3525 recusa
`msg.value`:

```solidity
/// @dev A rede não tem moeda nativa em circulação; ether enviado aqui seria
///      valor preso para sempre (invariante I6).
```

**`_exigirExistente`** — sutileza que produz bugs difíceis:

```solidity
/// @dev O valor zero do enum é ATIVO, de modo que um tokenId inexistente
///      pareceria ativo.
```

Em Solidity, ler um `mapping` em posição inexistente devolve zero, e o zero do
enum é o primeiro valor. Sem esta guarda, operar sobre token inexistente
avançaria e falharia adiante, com erro que não explica a causa.

**Storage gap:**

```solidity
uint256[40] private __vazio;   // armadilha clássica do UUPS
```

**Pausa com escopo limitado:**

```solidity
/// @dev Pausa congela movimentação. Não altera estado, não descongela contrato
///      congelado por divergência e não muda lógica — uma pausa que pudesse
///      fazer isso seria upgrade sem timelock com outro nome.
```

### `RegistroParticipantes` — circulação fechada

```solidity
/// @dev Habilitação vencida não habilita. A verificação é por tempo, e não por
///      alguém lembrar de revogar — o esquecimento é o caso comum.
```

`estaHabilitado()` devolve `h.ativo && h.validoAte > block.timestamp`. Duas
condições, e a segunda cobre o modo de falha real: ninguém esquece de revogar de
propósito, mas todo mundo esquece.

Guarda **o fato** (hash da atestação, validade), nunca o dossiê (P2).

### `CofreGarantias` — o nome que engana e a ausência que prova

```solidity
/// @notice FRONTEIRA REGULATÓRIA (P7): este contrato NÃO recebe, NÃO guarda e
///         NÃO transfere valor. Não há função payable, não há receive nem
///         fallback. "Cofre" é nome de registro de vínculos, não de custódia —
///         e a ausência é verificada em CI sobre a ABI.
```

Custodiar ativo virtual de terceiro cruzaria a fronteira regulatória que P7
proíbe. O contrato registra **vínculos** e **ordem de preferência**; a custódia
acontece fora, nos instrumentos jurídicos de garantia.

`npm run validar:contratos` varre a ABI e reprova qualquer `payable`, `receive`
ou `fallback`. A promessa não mora no comentário — é isso que G1 ensinou.

Duas regras do cofre:

```solidity
require(!_politicaExiste[politicaHash], "politica imutavel: crie nova versao");
```
Política imutável depois de registrada: recalibrar cria nova versão, para que
uma simulação antiga continue reproduzível (P6). Sem isso, um resultado de
waterfall guardado na trilha não poderia ser recomputado.

```solidity
if (_espelho.estaCongelado(tokenId)) revert EspelhoCongelado(tokenId);
```
Congelado não recebe garantia nova: enquanto o espelho diverge do registro, nada
se constrói sobre ele (P1).

---

## 5.2 As interfaces congeladas

`contracts/interfaces/*.sol` está sob o diretório de A1, mas segue o regime de
`docs/contracts/`: **congelado**. As ABIs em `docs/contracts/abi/` derivam dele e
o CI compara.

A razão é de coordenação. Os serviços conhecem a interface, não a implementação
(`cadeia.ts` carrega ABI). Se A1 pudesse mudar a interface livremente, cada
mudança quebraria os quatro outros agentes sem aviso — retrabalho em cascata, que
é exatamente o que o regime de congelamento existe para evitar.

Mudar interface exige SMC em `docs/contracts/MUDANCAS.md`, com impacto por agente.

---

## 5.3 As invariantes

`test/chain/invariantes.test.cjs` — a suíte que define o que não pode acontecer:

| # | Invariante | Princípio |
|---|---|---|
| I1 | Nunca dois tokens ativos para a mesma âncora | P3 |
| I1b | Âncoras distintas convivem; a baixa não libera a âncora | P3 |
| I2 | A soma das frações nunca excede o total emitido | P3 |
| I3 | Token congelado não transfere por nenhum caminho | P1 |
| I4 | Só o papel humano de reconciliação descongela | P1 |
| I5 | Atualizar hash documental não move valor nem titular | P1 |
| I6 | `msg.value` diferente de zero reverte | P7 |
| I7 | Nenhum evento carrega tipo capaz de transportar PII | P2 |
| I8 | `percorrerWaterfall` é determinística e sem efeito | P6 |
| I9 | Espelho não circula para quem não está habilitado | ADR-0005 |
| I9b | Habilitação vencida não habilita | ADR-0005 |

**I7 merece destaque.** Não testa que nenhum evento *contém* PII: testa que
nenhum evento **tem tipo capaz de transportá-la**. Todos os parâmetros de evento
são `bytes32`, `uint256` ou `address`. Não existe `string` na ABI de evento — e
sem `string`, um CPF não cabe. É prevenção estrutural em vez de vigilância.

**I3 é testada "por nenhum caminho"** — não apenas por `transferFrom`. Cada porta
nova precisa aparecer neste teste, o que faz de um `transferFrom` esquecido uma
falha e não uma omissão.

Complementam: `governanca.test.cjs` (timelock, propor/executar/cancelar),
`cobertura.test.cjs` e `ramos.test.cjs`. Total: **61 testes, 100% de statements,
funções e linhas; 90% de ramos**, medidos por `solidity-coverage`.

Os 10% de ramos não cobertos são, na maioria, guardas de reentrada em caminhos
sem chamada externa. Estão listados no relatório e não escondidos atrás de uma
meta arredondada.

---

## 5.4 Rede e ambiente

A rede-alvo é **Besu com consenso QBFT e quatro validadores** — permissionada,
sem moeda nativa em circulação, conforme ADR-0001. A composição está em
`infra/compose/besu/`.

O protótipo roda sobre **nó local do Hardhat**, com as chaves determinísticas
conhecidas. Isso é desvio consciente do ambiente-alvo, registrado no ADR-0008, e
`docs/ESTADO-DO-PROTOTIPO.md` diz com todas as letras: **a composição Besu nunca
foi executada** (não há daemon Docker neste ambiente). O que está provado é a
lógica dos contratos, não o comportamento sob QBFT.

Compilação usa `solcjs` local, sem rede — o que torna o build reprodutível e
independente de download (P6).

---

**Próximo:** [6. Serviços](06-servicos.md).
