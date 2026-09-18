-- cpr_audit :: trilha imutável
-- Instância separada, armazenamento append-only. Nenhuma credencial de
-- aplicação recebe UPDATE ou DELETE aqui — nem a de administração da app.

CREATE SCHEMA IF NOT EXISTS audit;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cpr_audit_writer') THEN
    CREATE ROLE cpr_audit_writer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cpr_audit_reader') THEN
    CREATE ROLE cpr_audit_reader NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA audit TO cpr_audit_writer, cpr_audit_reader;
