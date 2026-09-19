# Parecer E3 — Segurança de contratos inteligentes e qualidade de invariantes — Portão G2

> Parecer emitido com contexto isolado sobre o HEAD `162f48e`, em 2026-09-19.
> Reproduzido íntegro, sem edição do orquestrador. Todas as mutações do
> especialista foram revertidas; `git status` confirmado limpo pelo orquestrador
> após a entrega.

Todos os achados abaixo foram **executados** contra a EVM local (hardhat), salvo onde marcado `[#REF]`.

---

## Veredicto: **REPROVA**

Dois achados CRÍTICOS provados por execução: (a) qualquer endereço sequestra o `EspelhoCPR` inteiro antes do implantador legítimo; (b) a chave de serviço que congela também *sai* do congelamento sozinha, sem reconciliação humana — o exato inverso do que P1, o ADR-0007 e o NatSpec do próprio arquivo afirmam.

E um agravante que sozinho justificaria reprovação: **a suíte de invariantes não prova as propriedades que diz provar.** Removi a guarda de congelamento da origem da transferência token→token e drenei 100% de um token CONGELADO — os 61 testes passaram. Inflei `_circulanteDoSlot` em 1000× no fracionamento, violando I2 tal como enunciada na `docs/contracts/abi/README.md` — os 61 testes passaram. Cobertura de 100% statements / 90% branches está correta e é irrelevante: ela mede linhas executadas, não propriedades defendidas.

---

## Achados

### CRÍTICA

**C1 — `inicializar()` é pública, sem controle de acesso, e o deploy é em duas transações → sequestro total do espelho**
`contracts/src/EspelhoCPR.sol:71-82` (guarda é só `_inicializado`);
`contracts/scripts/implantar.cjs:21-24` (deploy e `inicializar` são txs separadas);
`test/chain/apoio.cjs:16-18` (mesmo padrão nos testes).

Vetor executado: o atacante observa a tx de deploy do `EspelhoCPR`, implanta seu próprio `ControleAcesso(atacante, 0)` e `RegistroParticipantes`, e chama `inicializar(acessoMau, partMau, ancora)` antes do implantador. Resultado medido: o implantador legítimo recebe `JaInicializado`; o atacante concede a si `PAPEL_ESPELHADOR` **com timelock zero**, habilita-se como participante e emite `10^18` unidades contra uma âncora arbitrária. Nada no contrato distingue o `_acesso` verdadeiro do falso.

Impacto: controle total do espelho, ou — na melhor hipótese — negação de serviço do deploy exigindo redeploy (e o endereço já publicado em `infra/enderecos.json` torna-se um contrato hostil). Aplica-se a qualquer rede permissionada em que uma conta não-implantadora possa emitir transações, o que inclui qualquer credor participante.

O teste `cobertura.test.cjs:139-144` ("não reinicializa") cobre apenas a *re*inicialização e cita a "armadilha clássica do UUPS" — mas a armadilha real do UUPS é a *primeira* inicialização por terceiro, que não é testada.

**C2 — `executar()` é rota de saída do congelamento operada pela mesma chave que congela (viola P1 e o ADR-0007)**
`contracts/src/EspelhoCPR.sol:149-157` — `executar` exige `PAPEL_CONCILIADOR` e aceita explicitamente `EstadoEspelho.CONGELADO`;
`contracts/src/EspelhoCPR.sol:123-128` — `congelar` exige o **mesmo** `PAPEL_CONCILIADOR`;
`contracts/src/EspelhoCPR.sol:130-131` — o NatSpec afirma "não há caminho automático (P1, ADR-0007)".

Sequência executada: `congelar(1, divergencia, CRITICA)` → `vincularGarantia` reverte com `EspelhoCongelado` (correto) → **`executar(1, decisao)` pela mesma chave conciliadora** → `estaCongelado(1) == false` → `vincularGarantia` **passa**. Depois disso o estado é irreversível: `congelar` reverte (`EstadoInvalido`, exige ATIVO) e `descongelar` reverte (`EstadoInvalido`, exige CONGELADO).

Impacto: a separação entre "quem concilia" e "quem reconcilia" — o núcleo de P1 e a razão de ser de todo o `ControleAcesso` — não existe no fluxo mais importante. Uma chave de serviço comprometida apaga a divergência, libera o cofre para receber garantias sobre um espelho divergente, e **tranca o token em um estado onde o reconciliador humano não tem mais nenhuma função a chamar**. O teste `cobertura.test.cjs:118-129` executa exatamente esta sequência e a assere como comportamento *esperado* ("executar aceita token ativo ou congelado") — o defeito está codificado como requisito.

---

### ALTA

**A1 — Não existe proxy. O UUPS com timelock é decorativo, e a âncora está amarrada à implementação**
`contracts/scripts/implantar.cjs:21-22` — `EspelhoCPR` é implantado diretamente e o `AncoraRegistro` recebe *esse* endereço como `espelho` imutável;
`contracts/src/EspelhoCPR.sol:249-258` — `executarAtualizacao` faz `sstore(_SLOT_IMPL, nova)`;
`contracts/src/AncoraRegistro.sol:12,19-26` — `espelho` é `immutable`.

Executado: propus uma implementação, avancei 72h, executei a atualização apontando o slot para um `AncoraRegistro`. `implementacao()` devolve o novo endereço; em seguida `valueDecimals()` ainda devolve 4, `balanceOf(1)` ainda devolve 1000 e uma nova emissão funciona normalmente. **Ninguém delega para aquele slot.** O teste `governanca.test.cjs:36-44` afere apenas que `implementacao()` mudou — ele prova que um `sstore` gravou, não que uma atualização ocorreu.

Impacto duplo: (i) o ADR-0004 promete ao credor corrigibilidade sem migração e ela não existe no artefato entregue; (ii) se um proxy for introduzido depois, `AncoraRegistro.espelho` apontará para a implementação e não para o proxy, e `somenteEspelho` bloqueará toda emissão — a única garantia estrutural de P3 (`AncoraRegistro`, declaradamente imutável) fica inutilizável e irreparável.

**A2 — Título liquidado deixa frações vivas, transferíveis e impossíveis de baixar**
`contracts/src/EspelhoCPR.sol:139-147` — `baixar` subtrai só `_saldo[tokenId]` e baixa a âncora;
`contracts/src/EspelhoCPR.sol:202-208` — a fração nova nunca é vinculada a âncora alguma.

Executado: emitir CPR-1 (1000) → fracionar 600 para credorB (token 2) → `baixar(1, comprovante)`. Medido: `ancoraBaixada(CPR-1) == true`, `estadoDo(2) == ATIVO`, `balanceOf(2) == 600`, `valorCirculanteDoSlot(1) == 600` — e a fração **foi transferida com sucesso depois da baixa**. Tentar `baixar(3)` reverte com `AncoraDesconhecida`, porque `ancoraDoToken(fração) == 0x00`.

Impacto: violação direta de P1 — o registro diz "liquidada", a cadeia diz "ativa e negociável", e não há função capaz de reconciliar. O valor fica travado em estado permanentemente divergente. A conciliação por âncora é cega às frações, porque frações não têm âncora. O teste `cobertura.test.cjs:100-108` ("baixa zera o circulante do slot") só passa porque nunca fraciona antes de baixar.

**A3 — `slot` é escolhido livremente pelo espelhador e não é ligado à âncora: valor migra entre CPRs distintas**
`contracts/src/EspelhoCPR.sol:88,102,106-107` — `slot_` é parâmetro de entrada, sem qualquer relação com `ancora_`;
`contracts/src/EspelhoCPR.sol:175-189` — `transferFrom(uint,uint,uint)` só exige `_slot[de] == _slot[para]`.

Executado: emitir CPR-1 (1000, slot 1) e CPR-2 (1000, **slot 1**) → credorB move 1000 do token 2 para o token 1. Medido: `balanceOf(1) == 2000` (o dobro do título registrado), `balanceOf(2) == 0`. Em seguida `baixar(1, comprovante-cpr1)` liquida 2000 unidades sob **um único comprovante**, zera o circulante do slot, e `ancoraBaixada(CPR-2) == false` — a CPR-2 continua viva no registro com um token esvaziado.

Impacto: a contabilidade "por slot" não corresponde a nada no registro. Colateral de um título é mobilizado sob outro — a vizinhança exata de P3. Nenhum teste da suíte emite duas âncoras no mesmo slot (`cobertura.test.cjs:70-77` usa slots *distintos*, para testar a rejeição).

**A4 — A janela de 72h do timelock de atualização não protege: a proposta aponta endereço sem código**
`contracts/src/EspelhoCPR.sol:242-247` — `proporAtualizacao` não verifica `nova.code.length`;
`contracts/src/EspelhoCPR.sol:254` — a verificação de código existe, mas só na **execução**.

Executado: calculei `getCreateAddress({from: atacante, nonce: n})`, chamei `proporAtualizacao(esseEndereço)` e confirmei `eth_getCode == 0x` durante toda a janela — não há bytecode a auditar. Avancei 72h+1, implantei o contrato naquele endereço e `executarAtualizacao` passou.

Impacto: o ADR-0004 justifica o timelock por "o credor precisa ter tempo hábil para observar uma mudança nas regras do ativo que detém — e, se for o caso, sair antes". O credor observa um endereço vazio. O que se executa não é o que se observou. Vale também para o `ControleAcesso`, que propõe endereços de contas e não de código, mas ali o problema é menor.

**A5 — A âncora é queimável de forma irreversível por uma única chave espelhadora**
`contracts/src/AncoraRegistro.sol:31-39` — `vincular` não tem caminho de liberação, cancelamento ou correção; o contrato é declaradamente imutável e sem proxy (`AncoraRegistro.sol:6-11`, ADR-0004 decisão 1).

Vetor: um `PAPEL_ESPELHADOR` comprometido (ou qualquer um, via C1) emite contra `sha256("REG-SIM|CPR-X")` de uma CPR que ainda não foi espelhada. A âncora fica permanentemente ocupada. A emissão legítima daquela CPR reverte para sempre com `AncoraJaUtilizada`, e não existe função — nem por upgrade, porque a âncora é imutável — capaz de desfazer. Verificado por leitura e pela ausência de qualquer mutador além de `vincular`/`baixar`; a irreversibilidade é assertada pelo próprio teste `invariantes.test.cjs:28-35`.

Impacto: negação de serviço permanente e barata sobre qualquer título futuro cujo identificador de registro seja previsível — e o identificador é previsível por construção (`apoio.cjs:7`). A decisão de imutabilidade, correta em tese, foi tomada sem um caminho de recuperação para vinculação indevida.

---

### MÉDIA

**M1 — O admin pode revogar a si mesmo e inutilizar a governança para sempre**
`contracts/src/ControleAcesso.sol:93-97` — `revogar` é `somenteAdmin`, aceita `_ADMIN` como alvo, não verifica se sobra algum admin, e é imediata.
Executado: `revogar(PAPEL_ADMIN, admin)` → em seguida `propor`, `conceder` e `proporAtualizacao` revertem todos com `SemPapel`. Não há mais como conceder `PAPEL_RECONCILIADOR_HUMANO`, o único capaz de descongelar (`EspelhoCPR.sol:132-137`), nem como atualizar o espelho. Como `_acesso` é gravado uma única vez no `inicializar` e não tem setter, o estado é irrecuperável. O mesmo mecanismo permite, com dois admins, que um remova o outro instantaneamente — captura de governança sem timelock, contrariando a decisão 3 do ADR-0004 ("autorização por multiassinatura").

**M2 — `executar()` fabrica evento de auditoria para token que nunca existiu**
`contracts/src/EspelhoCPR.sol:149-157` — usa `require` cru sobre `_estado[tokenId]` e não chama `_exigirExistente`, apesar de `EspelhoCPR.sol:265-270` documentar precisamente que "o valor zero do enum é ATIVO, de modo que um tokenId inexistente pareceria ativo".
Executado: `executar(999999, decisao)` passa, emite `EspelhoExecutado(999999, ...)` e grava `estadoDo(999999) == EXECUTADO`. Impacto em P5/P6: serviços de conciliação que consomem o log passam a ver execuções de títulos inexistentes, e a resposta a "o que se sabia e quando" fica poluída por eventos forjáveis a custo de gás. `ramos.test.cjs:13-19` testa a guarda em `baixar` e `congelar` — e não em `executar`.

**M3 — `PAPEL_ORIGINADOR` acumula compliance, não é sensível, e imobiliza ativo de terceiro sem timelock**
`contracts/src/RegistroParticipantes.sol:25-28` — o modifier chama-se `somenteCompliance` e exige `PAPEL_ORIGINADOR`;
`contracts/src/ControleAcesso.sol:55-57` — `papelSensivel` **exclui** `_ORIGINADOR`, logo a concessão é imediata via `conceder`.
Executado: `conceder(PAPEL_ORIGINADOR, estranho)` (uma tx, sem espera) → `desabilitar(credorA)` e `desabilitar(credorB)` → toda transferência reverte com `TitularNaoHabilitado`. É confusão de papel, não escolha: o mesmo papel que origina garantias no cofre decide quem entra e sai da circulação fechada. E o ADR-0007 argumenta que a imobilização de ativo alheio é o ponto regulatório mais sensível do sistema — ela está, aqui, no papel *menos* protegido.

**M4 — `haircutBps`/`capBps` não são validados, e a política é imutável: simulação morta por construção**
`contracts/src/CofreGarantias.sol:44-53` — valida `niveis.length == 5` e a ordem dos níveis, e nada mais;
`contracts/src/CofreGarantias.sol:131` — `(g.valor * (10_000 - n.haircutBps)) / 10_000`.
Executado: política com `haircutBps = 20000` no nível 1 → `configurarPolitica` aceita → `percorrerWaterfall` reverte com panic 0x11 (underflow) **para sempre**, porque `configurarPolitica` recusa sobrescrever (`CofreGarantias.sol:45`). O `capBps` sem teto tem o problema simétrico no produto `exposicao * n.capBps`. Impacto: o mecanismo que o NatSpec descreve como "o que permite ao comprador de risco verificar por conta própria" é desativável por um erro de digitação do originador, sem recuperação além de nova política e novo `vincularPolitica`.

**M5 — `validar:contratos` cobre apenas as interfaces; a fronteira P7 e a invariante I6 não alcançam a implementação**
`infra/ci/validar-abis.mjs:13` — `FONTES = contracts/interfaces`;
`docs/contracts/abi/README.md:31-36` — afirma que o validador "reprova o build se aparecer na ABI qualquer função de custódia [...] É a Seção 2, P7, em código executável".
Executado: inseri em `EspelhoCPR.sol` duas funções, `custodiarAtivoDeTerceiro` e `depositarGarantindoRendimento(uint256) external payable { _saldo[t] += msg.value; }`. `npm run validar:contratos` imprimiu **"OK P7: nenhuma função de custódia, novação ou promessa de rendimento na ABI"**. `npm run validar:p7` pegou a primeira (varredura de fonte) e **não pegou a segunda**. E `npx hardhat test` deu **61 passing**, com o I6 verde — porque I6 (`invariantes.test.cjs:100-106`) testa `approve`, um caso, e não a propriedade "toda função payable recusa valor". Uma função payable que aprisiona ether permanentemente atravessa os três portões.

---

### BAIXA

**B1 — O teste "P7 — nenhum contrato aceita ether" testa cinco vezes o mesmo contrato**
`test/chain/governanca.test.cjs:67-75`: `c[nome[0].toLowerCase() + nome.slice(1)]` produz `cofreGarantias`, `ancoraRegistro`, `controleAcesso`, `registroParticipantes` — chaves que não existem no objeto devolvido por `montar()` (`apoio.cjs:50-51` expõe `acesso, participantes, espelho, ancora, cofre`). O `?? await c.espelho.getAddress()` faz todas caírem no espelho. Executei a resolução de nomes: os cinco alvos resolvem para o mesmo endereço, `0x9fE4...a6e0`. Verde falso: `CofreGarantias`, `AncoraRegistro`, `ControleAcesso` e `RegistroParticipantes` nunca foram testados quanto a receber ether.

**B2 — `atualizarHashDocumental` reescreve a verdade documental com uma única chave, sem quórum (P4)**
`contracts/src/EspelhoCPR.sol:112-120`: `origemHash` é parâmetro decorativo — não é verificado, não é comparado, não é persistido. Executado: três reescritas consecutivas pelo espelhador, cada uma aceita sem evidência. P4 exige quórum mínimo de duas fontes para "toda leitura crítica"; o hash documental é o elo entre o token e o título registrado, e depende de uma fonte única sem caminho de disputa.

**B3 — `tx.origin` em evento de auditoria**
`contracts/src/AncoraRegistro.sol:38`: `emit AncoraVinculada(ancora, tokenId, tx.origin)`. O "autor" registrado é o originador da transação, não o `EspelhoCPR` que de fato vinculou nem o espelhador identificado. Sob P5 ("timestamp, origem, autor e evidência") isso atribui autoria errada em qualquer chamada mediada por contrato, e cria dependência de um valor que a EVM desencoraja.

**B4 — NatSpec da interface congelada descreve a função errada**
`contracts/interfaces/IEspelhoCPR.sol` — o bloco "Soma das frações vivas de um slot. Invariante de W1: nunca excede o total emitido para o slot" está sobre `valorEmitidoDoSlot`, e descreve `valorCirculanteDoSlot`. Em interface congelada que serve de contrato entre agentes, isso induz erro de integração.

---

## Prova por mutação — o que a suíte não detecta

Rodei cada mutação contra as quatro suítes (`invariantes`, `cobertura`, `governanca`, `ramos`) e revertí todas.

| Mutação | Suíte | Veredicto |
|---|---|---|
| Remover `_exigirNaoCongelado(deTokenId)` de `transferFrom(uint,uint,uint)` (EspelhoCPR.sol:180) | **61 passing** | **SOBREVIVE.** Confirmei o exploit: token congelado drenado de 1000 → 0 para um token são. I3 diz "por nenhum caminho" e testa dois caminhos, ambos de fracionamento; o caminho token→token só é coberto com o **destino** congelado (`cobertura.test.cjs:89-96`), o que mantém a segunda guarda viva. |
| `_circulanteDoSlot[slot] += valor * 1000` no fracionamento (EspelhoCPR.sol:203) | **61 passing** | **SOBREVIVE.** Medido: `emitido = 1000`, `circulante = 501000`. A invariante I2 do `docs/contracts/abi/README.md` é literalmente `valorCirculanteDoSlot <= valorEmitidoDoSlot, sempre` — e `valorCirculanteDoSlot` **não é lido em nenhum ponto do `invariantes.test.cjs`**. O que I2 testa (`invariantes.test.cjs:57-60`) é a soma de `balanceOf` de tokens que o próprio teste rastreia, o que é uma tautologia do fracionamento: subtrai de um e soma ao outro. |
| Inserir `depositarGarantindoRendimento(uint256) external payable` em EspelhoCPR | **61 passing** + `validar:contratos` OK + `validar:p7` OK | **SOBREVIVE** em todos os portões (ver M5). |

Conclusão de qualidade: `docs/panel/G2/evidencia/cobertura-contratos.txt` reporta 100/90/100/100 e está correto — e mede a coisa errada. A meta I10 ("cobertura ≥ 90%") foi atingida; as metas I2, I3 e I6, que o README chama de "definição de pronto", não foram. Não encontrei sinal de que as invariantes tenham sido escritas antes da implementação: I2 assere a mecânica interna escolhida pelo código (soma de saldos rastreados) em vez da propriedade publicada (`circulante <= emitido`), e `cobertura.test.cjs:118-129` codifica o defeito C2 como comportamento esperado — ambos são a assinatura de teste escrito depois, a partir do código.

---

## Invariantes ausentes

1. **I2 como está enunciada.** Nenhum teste lê `valorCirculanteDoSlot` fora de dois casos-ponto. Falta fuzzing que, após *cada* operação de uma sequência aleatória misturando `emitirEspelho`, ambos os `transferFrom`, `baixar`, `congelar` e `executar`, afira `valorCirculanteDoSlot(s) <= valorEmitidoDoSlot(s)` **e** `valorCirculanteDoSlot(s) == soma de balanceOf de todos os tokens do slot` — esta segunda é a que pega A2 e A3.
2. **"Congelado não transfere por nenhum caminho", de fato.** Para cada uma das quatro funções mutantes que tocam saldo ou permissão (`approve`, ambos os `transferFrom`, `baixar`), com o token congelado na origem **e** no destino. Oito casos; hoje há três.
3. **"Nenhuma transição sai de CONGELADO sem `PAPEL_RECONCILIADOR_HUMANO`."** Invariante de máquina de estados, não de função: enumerar toda a ABI mutante, chamar cada função com cada papel sobre um token congelado, e afirmar que `estadoDo` ou continua CONGELADO ou a chamada reverteu. Pega C2 imediatamente.
4. **"Toda função `payable` da ABI compilada de `src/` recusa `msg.value != 0`."** Derivada da ABI por iteração, não escrita à mão. Pega M5 e torna I6 uma propriedade em vez de um exemplo.
5. **"Todo token com saldo > 0 tem âncora, e a âncora não está baixada."** Pega A2. Corolário: "todo token do slot s tem a mesma âncora" — pega A3.
6. **"Toda função mutante reverte para `tokenId` inexistente."** Iterar a ABI contra `tokenId = 2^200`. Pega M2, e teria pegado qualquer irmão dele.
7. **Inicialização.** "Chamar `inicializar` de um endereço qualquer imediatamente após o deploy reverte." Pega C1. Hoje só se testa a reinicialização.
8. **Governança.** "Não existe sequência de chamadas ao `ControleAcesso` que deixe o conjunto de `PAPEL_ADMIN` vazio." Pega M1.
9. **Atualização.** "`proporAtualizacao` exige código no alvo no momento da proposta, e `executarAtualizacao` exige que o `EXTCODEHASH` seja o mesmo observado na proposta." Pega A4.
10. **Limites numéricos do cofre.** Fuzzing de `haircutBps`/`capBps` em `[0, 2^16)` provando que `percorrerWaterfall` nunca reverte por aritmética. Pega M4.

---

## O que NÃO consegui verificar

- **Comportamento sob um proxy real.** Não há proxy no repositório; todas as afirmações sobre colisão de slot, `__vazio[40]` e preservação de layout entre implementações são inverificáveis na prática, porque não existe segunda implementação nem delegação. O gap está declarado e o `_SLOT_IMPL` é o valor ERC-1967 correto, mas isso é leitura, não prova.
- **Reentrância sob `_acesso`/`_participantes`/`_ancora` hostis.** Na configuração legítima não há vetor (todos os callees são contratos fixos, sem callback, sem valor). Sob C1 o atacante controla os três e `_ancora.vincular` em `EspelhoCPR.sol:99` precede as escritas de estado das linhas 101-107 — não explorei esse caminho porque C1 já concede controle total e o resultado seria redundante.
- **Concorrência real de mempool.** Provei que a segunda emissão para a mesma âncora reverte atomicamente (`vincular` antes de qualquer escrita, `EspelhoCPR.sol:97-107`), mas em hardhat com `mining: auto` não há mempool; o comportamento sob reordenação de blocos em Besu/QBFT é `[#REF]`.
- **Se o timelock de 72h é o efetivo em produção.** `apoio.cjs:8` e `implantar.cjs:15` usam valores distintos, e o ambiente real é `[#REF]` — o ADR-0008 registra o desvio de ambiente.
- **`npx hardhat coverage` rodado por mim.** Li a evidência congelada em `docs/panel/G2/evidencia/cobertura-contratos.txt` e reproduzi a suíte (61 passing), mas não reexecutei a instrumentação de cobertura; os números da tabela são do artefato, não medidos nesta sessão.
- **Custo em gás / DoS por crescimento de array.** `_garantiasDoToken[tokenId]` (`CofreGarantias.sol:70`) cresce sem limite e é percorrido cinco vezes em `percorrerWaterfall`; não medi o ponto de estouro de gás.
- **Se os `docs/contracts/abi/*.json` conferem com as interfaces.** `validar:contratos` passou nesta sessão, então conferem — mas isso valida interfaces contra interfaces. Não existe validação da ABI da **implementação** contra nada.

---

## O que está bem feito (conferido no código)

- **`AncoraRegistro` como contrato separado, imutável, sem proxy, com `somenteEspelho`** (`AncoraRegistro.sol:11-26`). A decisão de não deixar a unicidade do colateral depender de quem controla o proxy é correta e está implementada como descrita. `vincular` reverte na segunda âncora, e baixar não devolve a âncora ao pool — ambos executados.
- **Ordem correta em `emitirEspelho`**: `_ancora.vincular` na linha 99, antes de qualquer escrita de estado (linhas 101-107). Duas transações concorrentes para a mesma âncora não podem ambas ter sucesso, e a que falha não deixa estado parcial. Executado.
- **`semValor`** (`EspelhoCPR.sol:61-64`) está aplicado nas três funções `payable` existentes hoje — `approve` e os dois `transferFrom`. O que falta é a garantia estrutural de que continuará assim (M5), não a implementação atual.
- **Timelock realmente no código, e não só no NatSpec** (`ControleAcesso.sol:55-57, 63-76, 85-89`). `conceder` reverte para papel sensível com `PapelExigeTimelock`, e `executarProposta` verifica `block.timestamp`. A correção do SMC-005 foi feita de verdade; verifiquei que `propor` não consegue encurtar o prazo de uma proposta existente.
- **Revogação imediata** (`ControleAcesso.sol:93-97`) é a escolha certa, e o comentário explica por quê. O defeito (M1) é a ausência de guarda do último admin, não a imediatez.
- **`_disponivelNoNivel`** (`CofreGarantias.sol:123-135`): o teto por nível e o deságio estão corretos, a ordem das operações (multiplicar antes de dividir) evita perda de precisão desnecessária, e `percorrerWaterfall` é genuinamente `view` e determinística — executada em dois blocos distintos com resultado idêntico.
- **Habilitação com expiração por tempo** (`RegistroParticipantes.sol:43-46`), e não por alguém lembrar de revogar. Correta, e o teste I9b prova.
- **Ausência deliberada de qualquer função de escrita no registro** em todo o conjunto. Verifiquei por leitura integral dos cinco contratos: não há rota que corrija o registro a partir do token. P1, nesse aspecto específico, está estruturalmente respeitado.
- **`CofreGarantias` sem `payable`, sem `receive`, sem `fallback`** — verificado na ABI compilada, não só na interface.
