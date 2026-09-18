# ABIs congeladas de W1

Geradas a partir de `contracts/interfaces/*.sol` com solc 0.8.28. **Não edite
estes arquivos à mão.** O fluxo é: alterar a interface Solidity, abrir
solicitação de mudança de contrato e, aprovada, rodar
`node infra/ci/validar-abis.mjs --gerar`.

O CI recompila as interfaces e compara byte a byte com o que está aqui. Uma
divergência significa que a implementação e o contrato saíram de sincronia —
o risco de maior probabilidade da tabela da Seção 11 do briefing.

## Invariantes que A1 precisa provar em W1

Estas não são sugestões de teste: são a definição de pronto do workstream.
Cada uma corresponde a um princípio que, se falhar, derruba a tese do MVP.

| # | Invariante | Princípio | Como provar |
|---|---|---|---|
| I1 | Nunca existem dois tokens ativos para a mesma âncora | P3 | Fuzzing sobre `emitirEspelho` com âncoras repetidas; `AncoraJaUtilizada` sempre |
| I2 | `valorCirculanteDoSlot <= valorEmitidoDoSlot`, sempre | P3 | Invariant test com sequência aleatória de transferências e fracionamentos |
| I3 | Token congelado não transfere valor por nenhum caminho | P1 | Invariant test: após `congelar`, toda `transferFrom` reverte |
| I4 | Só `PAPEL_RECONCILIADOR_HUMANO` descongela, e nunca chave de serviço | P1 | Teste de controle de acesso com todas as demais chaves |
| I5 | Nenhuma função altera termos econômicos sem evidência do registro | P1 | Revisão de E3 + teste de que `atualizarHashDocumental` não move valor |
| I6 | `msg.value != 0` reverte em toda função payable herdada do padrão | P7 | Teste direto; ether preso é valor travado |
| I7 | Nenhum evento emite dado pessoal | P2 | Varredura de calldata e logs no cenário completo (W5 fornece o varredor) |
| I8 | `percorrerWaterfall` é determinística e livre de efeito | P6 | Mesma entrada, mesmo resultado, em duas execuções e dois blocos |
| I9 | Espelho não transfere para endereço não habilitado | P7 | Teste com participante desabilitado e com habilitação expirada |
| I10 | Cobertura de linhas e ramos ≥ 90% | — | `forge coverage` no portão de CI |

## Fronteira regulatória em forma de teste

`infra/ci/validar-abis.mjs` reprova o build se aparecer na ABI qualquer função
de custódia, novação, promessa de rendimento ou escrita no registro, e se
qualquer função mutante passar a aceitar texto livre. É a Seção 2, P7, em
código executável — exatamente o que o briefing exige ao dizer que a proibição
não pode viver apenas em documento.
