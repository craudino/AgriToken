# Migrações de `cpr_pii`

A baseline é `docs/contracts/db/pii/*.sql` — o esquema congelado da Fase 0,
aplicado uma vez e registrado com checksum. Daqui em diante, **mudança de
esquema é arquivo novo aqui**, nunca edição da baseline.

Nome: `NNNN-verbo-objeto.sql`, com numeração sequencial de quatro dígitos.

Regras que o runner impõe, não sugere:

1. Migração aplicada é imutável. Alterar o conteúdo de um arquivo já aplicado
   interrompe a migração inteira, em todas as bases, sem aplicar nada.
2. Cada migração roda em transação própria. Não existe meia-migração.
3. A ordem é lexicográfica e a execução para na primeira falha.

Toda migração que altere contrato congelado precisa de solicitação em
`docs/contracts/MUDANCAS.md` antes de existir aqui.
