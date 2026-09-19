# Prova por execução do achado C1 (E2) — reidentificação sobrevive à eliminação

Executado em 2026-09-19 sobre HEAD `162f48e`, com a pilha de pé.

## Roteiro

1. `POST /onboarding` com CPF sintético `529.982.247-25` → `produtor_ref = 4cc6d48d…`, KYC `APROVADO`
2. `POST /titulares/4cc6d48d…/eliminacao` → `estado = CONCLUIDO`,
   `verificacao_irreversibilidade = { tentativa_decifragem: 'FALHOU_COMO_ESPERADO' }`
3. Partindo **apenas do CPF** e da chave de serviço `CHAVE_INDICE_CEGO`, recomputar
   HMAC-SHA256 e consultar `pii.titular WHERE documento_hmac = $1`

## Resultado

```
LINHA ENCONTRADA partindo apenas do CPF:
  titular_id      = 0d1a8da2-29f1-4b0d-a57a-eff143fa0c19
  eliminado_em    = 2026-09-19T11:05:49.637Z
  ops_produtor_id = 905b941a-2314-4a90-8a68-ef84f127d3dc
```

O sistema devolveu comprovante de irreversibilidade ao titular e, em seguida, o
titular foi localizado a partir do documento dele. O vínculo CPF →
`ops_produtor_id` sobrevive. A chave do índice é uma só (32 caracteres, variável
de ambiente) para todos os titulares, e a eliminação não a toca — destruí-la
para eliminar um titular destruiria o índice de todos.

O que o crypto-shredding **fez** funcionar: `nome_cif` continua na linha e está
ilegível, porque a chave AES daquele titular foi destruída. O defeito não está
na cifragem; está numa segunda chave que o desenho não tratou como chave.

## Nota sobre a primeira tentativa desta prova, que falhou

A primeira execução imprimiu `LINHA AUSENTE — reidentificação impossível`, e a
conclusão preguiçosa seria "E2 errou".

A sonda é que estava errada: ela computou o HMAC com o valor padrão `'dev'`
(`process.env.CHAVE_INDICE_CEGO ?? 'dev'`) enquanto o processo do compliance
tinha a variável definida. Consultar a tabela diretamente mostrou a linha
eliminada presente, com `documento_hmac` intacto — foi isso que expôs o erro da
sonda.

É a mesma lição do caso de controle em `aceite-oraculo.mjs`: um teste que não
encontra o que procura pode estar provando que o mecanismo funcionou, ou que a
busca estava mal formulada. Sem um controle que distinga os dois, o resultado
não vale nada — e aqui o resultado inválido era o que absolvia o sistema.

## Reprodução

```bash
CHAVE=$(tr '\0' '\n' < /proc/$(cat .run/compliance.pid)/environ \
        | grep '^CHAVE_INDICE_CEGO=' | cut -d= -f2-)
CHAVE_INDICE_CEGO="$CHAVE" node -e "…hmacDocumento(CPF, process.env.CHAVE_INDICE_CEGO)…"
```
