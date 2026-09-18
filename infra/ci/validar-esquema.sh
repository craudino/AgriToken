#!/usr/bin/env bash
# Portão de CI: sobe três bases efêmeras, aplica os esquemas congelados e roda
# os testes de conformidade. Uma falha aqui significa que um princípio da
# Seção 2 do briefing deixou de ser executável — o build para.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ESQUEMAS="$RAIZ/docs/contracts/db"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
BASE="${BASE_TMP:-/var/lib/postgresql/cpr-ci}"
PORTA="${PGPORT_CI:-5433}"

# Caminho remoto: quando as três URLs são fornecidas (CI com serviço de banco),
# aplica nelas em vez de subir cluster próprio. As bases precisam ser distintas.
if [[ -n "${OPS_URL:-}" && -n "${PII_URL:-}" && -n "${AUDIT_URL:-}" ]]; then
  "$RAIZ/infra/db/aplicar.sh"
  falhas=0
  psql "$OPS_URL"   -v ON_ERROR_STOP=1 -q -f "$ESQUEMAS/testes/conformidade_ops.sql"   2>&1 | sed 's/.*NOTICE:  //' || falhas=1
  psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -q -f "$ESQUEMAS/testes/conformidade_audit.sql" 2>&1 | sed 's/.*NOTICE:  //' || falhas=1
  suspeitas=$(grep -nEi '^[[:space:]]+(cpf|cnpj|nome|email|e_mail|telefone|endereco|rg|conta_bancaria)[[:space:]]' \
               "$ESQUEMAS/ops"/*.sql || true)
  if [[ -n "$suspeitas" ]]; then
    echo "ERRO (P2): coluna com nome de campo identificante em cpr_ops:"; echo "$suspeitas"; falhas=1
  fi
  [[ $falhas -eq 0 ]] && { echo "esquema conforme"; exit 0; } || { echo "esquema NAO conforme" >&2; exit 1; }
fi

# O PostgreSQL recusa rodar como root. Em runner root (contêiner de CI),
# reexecuta o script sob um usuário sem privilégio.
if [[ "$(id -u)" -eq 0 ]]; then
  USUARIO="${PG_RUN_AS:-postgres}"
  id "$USUARIO" >/dev/null 2>&1 || useradd -m "$USUARIO"
  mkdir -p "$BASE"; chown -R "$USUARIO" "$BASE" 2>/dev/null || true
  exec su "$USUARIO" -c "RAIZ_CI='$RAIZ' PGBIN='$PGBIN' BASE_TMP='$BASE' PGPORT_CI='$PORTA' bash '$0'"
fi

limpar() { "$PGBIN/pg_ctl" -D "$BASE/data" stop -m immediate >/dev/null 2>&1 || true; }
trap limpar EXIT

rm -rf "$BASE"; mkdir -p "$BASE/data" "$BASE/sock"
"$PGBIN/initdb" -D "$BASE/data" -U postgres -E UTF8 --locale=C >/dev/null
"$PGBIN/pg_ctl" -D "$BASE/data" -o "-k $BASE/sock -p $PORTA -c listen_addresses=" -l "$BASE/pg.log" start >/dev/null
sleep 2

psql="$PGBIN/psql -h $BASE/sock -p $PORTA -U postgres -v ON_ERROR_STOP=1 -q"
for db in cpr_ops cpr_pii cpr_audit; do
  "$PGBIN/createdb" -h "$BASE/sock" -p "$PORTA" -U postgres "$db"
done

for dir in ops pii audit; do
  db="cpr_$dir"
  for f in "$ESQUEMAS/$dir"/*.sql; do $psql -d "$db" -f "$f"; done
done

falhas=0
for t in "$ESQUEMAS/testes"/conformidade_ops.sql; do
  $psql -d cpr_ops -f "$t" 2>&1 | grep -E "NOTICE|ERROR" | sed 's/.*NOTICE:  //' || falhas=1
done
$psql -d cpr_audit -f "$ESQUEMAS/testes/conformidade_audit.sql" 2>&1 | grep -E "NOTICE|ERROR" | sed 's/.*NOTICE:  //' || falhas=1

# Varredura de PII no próprio DDL: nenhuma coluna de cpr_ops pode se chamar
# como um campo identificante. Controle barato, verificação constante (P2).
suspeitas=$(grep -nEi '^[[:space:]]+(cpf|cnpj|nome|email|e_mail|telefone|endereco|rg|conta_bancaria)[[:space:]]' \
             "$ESQUEMAS/ops"/*.sql || true)
if [[ -n "$suspeitas" ]]; then
  echo "ERRO (P2): coluna com nome de campo identificante em cpr_ops:"; echo "$suspeitas"; falhas=1
fi

[[ $falhas -eq 0 ]] && echo "esquema conforme" || { echo "esquema NAO conforme" >&2; exit 1; }
