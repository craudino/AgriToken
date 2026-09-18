#!/usr/bin/env bash
# Sobe o ambiente de dados local: um cluster, três bancos, três credenciais.
# A separação física exigida pelo ADR-0002 está desviada aqui e o desvio está
# registrado no ADR-0008 — em produção são três instâncias.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
BASE="${CPR_PG_DIR:-/var/lib/postgresql/cpr-dev}"
PORTA="${CPR_PG_PORT:-5440}"
USUARIO="${PG_RUN_AS:-postgres}"

if [[ "$(id -u)" -eq 0 ]]; then
  id "$USUARIO" >/dev/null 2>&1 || useradd -m "$USUARIO"
  mkdir -p "$BASE"; chown -R "$USUARIO" "$BASE"
  exec su "$USUARIO" -c "PGBIN='$PGBIN' CPR_PG_DIR='$BASE' CPR_PG_PORT='$PORTA' bash '${BASH_SOURCE[0]}'"
fi

if [[ ! -s "$BASE/data/PG_VERSION" ]]; then
  rm -rf "$BASE"; mkdir -p "$BASE/data" "$BASE/sock"
  "$PGBIN/initdb" -D "$BASE/data" -U postgres -E UTF8 --locale=C >/dev/null
fi

if ! "$PGBIN/pg_isready" -h "$BASE/sock" -p "$PORTA" >/dev/null 2>&1; then
  "$PGBIN/pg_ctl" -D "$BASE/data" \
    -o "-k $BASE/sock -p $PORTA -c listen_addresses=127.0.0.1" \
    -l "$BASE/pg.log" start >/dev/null
  sleep 2
fi

psql="$PGBIN/psql -h $BASE/sock -p $PORTA -U postgres -v ON_ERROR_STOP=1 -q"

# Uma credencial por base. services/core não recebe senha do cofre de PII, e
# não é por disciplina: é por não existir usuário que sirva às duas.
$psql -d postgres -c "DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cpr_ops_app')  THEN CREATE ROLE cpr_ops_app  LOGIN PASSWORD 'dev_ops';   END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cpr_pii_svc')  THEN CREATE ROLE cpr_pii_svc  LOGIN PASSWORD 'dev_pii';   END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cpr_audit_svc') THEN CREATE ROLE cpr_audit_svc LOGIN PASSWORD 'dev_audit'; END IF;
END \$\$;"

for db in cpr_ops cpr_pii cpr_audit; do
  if ! $psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1; then
    "$PGBIN/createdb" -h "$BASE/sock" -p "$PORTA" -U postgres "$db"
  fi
done

for dir in ops pii audit; do
  for f in "$RAIZ/docs/contracts/db/$dir"/*.sql; do
    $psql -d "cpr_$dir" -f "$f" >/dev/null 2>&1 || true
  done
done
$psql -d cpr_ops -f "$RAIZ/infra/db/referencia.sql" >/dev/null

$psql -d cpr_ops   -c "GRANT USAGE ON SCHEMA ops, sim TO cpr_ops_app;
                        GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA ops, sim TO cpr_ops_app;
                        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ops, sim TO cpr_ops_app;
                        GRANT USAGE ON SCHEMA geo TO cpr_ops_app;
                        GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA geo TO cpr_ops_app;" >/dev/null
$psql -d cpr_pii   -c "GRANT USAGE ON SCHEMA pii TO cpr_pii_svc;
                        GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA pii TO cpr_pii_svc;
                        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pii TO cpr_pii_svc;" >/dev/null
# Na trilha, o serviço insere e lê. Não recebe UPDATE nem DELETE — e mesmo que
# recebesse, o gatilho recusaria (P5).
$psql -d cpr_audit -c "GRANT USAGE ON SCHEMA audit TO cpr_audit_svc;
                        GRANT SELECT, INSERT ON audit.registro TO cpr_audit_svc;
                        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA audit TO cpr_audit_svc;" >/dev/null

echo "socket=$BASE/sock porta=$PORTA"
echo "OPS_URL=postgres://cpr_ops_app:dev_ops@127.0.0.1:$PORTA/cpr_ops"
echo "PII_URL=postgres://cpr_pii_svc:dev_pii@127.0.0.1:$PORTA/cpr_pii"
echo "AUDIT_URL=postgres://cpr_audit_svc:dev_audit@127.0.0.1:$PORTA/cpr_audit"
