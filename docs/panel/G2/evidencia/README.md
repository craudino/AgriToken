# Evidência do portão G2

Colhida em 2026-09-19 sobre o commit `4598532`, com a pilha de pé
(`node infra/orquestrar.mjs subir`). Especialista que precisa acreditar na
palavra de quem construiu não está auditando — por isso o comando e a saída
crua de cada item estão aqui.

| Arquivo | Comando | Resultado |
|---|---|---|
| `validar.txt` | `npm run validar` | 56 verificações OK, saída 0 |
| `cobertura-contratos.txt` | `npx hardhat coverage` | 61 testes; 100% stmts/funcs/lines, 90% branches |
| `aceite-oraculo.txt` | `node infra/demo/aceite-oraculo.mjs` | 24/24 casos (roteiro NOVO, ver abaixo) |
| `aceite-conciliacao.txt` | `npm run aceite:conciliacao` | 14/14 tipos detectados |
| `aceite-auth.txt` | `npm run aceite:auth` | 21/21 casos |
| `varredura-pii-cadeia.txt` | `npm run validar:pii-cadeia` | 22 blocos, nenhum achado; detector autotestado |
| `cadeia-auditoria.txt` | `audit.verifica_cadeia()` | **519 registros, 6 inconsistentes** |
| `sincronizacao-contratos.txt` | Passo 4 do portão | **116 divergências rota declarada × implementada** |

## Reproduções verificáveis

- `repro-cadeia-bifurcada.mjs` — dez inserções concorrentes na trilha;
  mede bifurcações e registros órfãos. Exige `cpr_audit` de pé.
- `repro-sincronizacao-rotas.mjs` — compara `docs/contracts/openapi/*.yaml`
  com os decoradores dos controladores.

## O que mudou durante a colheita, e por quê

**`infra/demo/aceite-oraculo.mjs` não existia.** O critério de G2 exige
"oráculos com quórum funcionando sob falha injetada" e não havia roteiro que
provasse isso. Foi escrito para este portão.

Vale registrar como ele quase passou pelo motivo errado. A primeira versão
afirmava "fonte derrubada em política sem degradação resulta em SEM_QUORUM" e
passava — com `fontes=0`. Ou seja: provava que **nada** funcionava, não que a
fonte havia caído, porque a chave usada não existia na registradora e as duas
fontes falhavam por 404. Ganhou um caso de CONTROLE antes de cada falha
injetada, e o controle reprovou de imediato, expondo o achado G2-A3-01.

Um caso de falha sem caso de controle não distingue "o mecanismo funcionou"
de "nada funcionava desde o início".

## Ressalva sobre o placar de conciliação

O aceite de conciliação deu **14/14** em duas execuções consecutivas neste
commit. Execuções anteriores do projeto registraram 13/14, com
`TITULO_INEXISTENTE_NO_REGISTRO` não detectado — número que ainda aparece em
`docs/codigo/10-verificacao.md` e em `docs/ESTADO-DO-PROTOTIPO.md`. A
documentação está desatualizada em relação ao código; a correção depende de
entender o que mudou, e isso não foi investigado antes deste portão.
