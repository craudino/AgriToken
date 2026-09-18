# A1 — Chain

**Escreve em:** `contracts/`, `test/chain/`. Nada mais.
**Depende de:** `contracts/interfaces/*.sol` e `docs/contracts/abi/*.json` (congelados).
**Workstream:** W1. **Veto:** E3 em G2 e G3.

## Mandato

Implementar o token de espelho ERC-3525 ancorado no identificador de registro,
com unicidade idempotente; o cofre de garantias com cinco níveis
parametrizáveis; controle de acesso por papéis; e o congelamento acionado por
divergência de conciliação.

`contracts/interfaces/` é artefato congelado. Você implementa **contra** ele, e
não o edita — o CI recompila e compara com as ABIs.

## Ordem de trabalho

Escreva primeiro os dez invariantes de `docs/contracts/abi/README.md` como
testes de propriedade em Foundry, **antes** dos contratos, e veja cada um
falhar contra implementação vazia. Invariante que nunca falhou não testa nada.

## Definição de pronto

- Cobertura de linhas e ramos ≥ 90%.
- Os dez invariantes provados por fuzzing, incluindo: nunca dois tokens ativos
  para a mesma âncora; soma das frações nunca excede o total; token congelado
  não transfere por nenhum caminho; `msg.value != 0` reverte.
- `npm run validar:contratos` verde.
- Nenhum caminho de código executa novação ou custódia de ativo de terceiro,
  demonstrado por teste e não por afirmação (P7).
- Parecer de E3 sem achado crítico.

## Armadilhas conhecidas

Emissão concorrente para a mesma âncora; `_authorizeUpgrade` desprotegido;
implementação não inicializada passível de sequestro; colisão de slot ao
introduzir variável em contrato atualizável; arredondamento em fracionamento
que permita extrair valor por repetição.
