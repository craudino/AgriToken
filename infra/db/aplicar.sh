#!/usr/bin/env bash
# Aplica os esquemas congelados da Fase 0 nas três bases físicas.
# Idempotente na criação de schemas e papéis; os DDL de tabela não são —
# em ambiente já provisionado, use as migrações de A7 sobre este baseline.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ESQUEMAS="$RAIZ/docs/contracts/db"

: "${OPS_URL:?defina OPS_URL (base operacional)}"
: "${PII_URL:?defina PII_URL (cofre de PII)}"
: "${AUDIT_URL:?defina AUDIT_URL (trilha de auditoria)}"

if [[ "$OPS_URL" == "$PII_URL" || "$OPS_URL" == "$AUDIT_URL" || "$PII_URL" == "$AUDIT_URL" ]]; then
  echo "ERRO: as três bases precisam ser fisicamente distintas (ver ADR-0002)." >&2
  exit 2
fi

aplicar() {
  local url="$1" dir="$2"
  for f in "$dir"/*.sql; do
    echo "  -> $(basename "$f")"
    psql "$url" -v ON_ERROR_STOP=1 -q -f "$f"
  done
}

echo "cpr_ops";   aplicar "$OPS_URL"   "$ESQUEMAS/ops"
echo "cpr_pii";   aplicar "$PII_URL"   "$ESQUEMAS/pii"
echo "cpr_audit"; aplicar "$AUDIT_URL" "$ESQUEMAS/audit"
echo "esquemas aplicados"
