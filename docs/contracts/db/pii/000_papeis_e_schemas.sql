-- cpr_pii :: cofre de identificação
-- Instância física separada. Credencial exclusiva de services/compliance (A5).
-- Nenhum outro serviço tem rota de rede até aqui.

CREATE SCHEMA IF NOT EXISTS pii;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cpr_pii_app') THEN
    CREATE ROLE cpr_pii_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cpr_pii_auditor') THEN
    CREATE ROLE cpr_pii_auditor NOLOGIN;   -- lê metadados, nunca texto claro
  END IF;
END
$$;

GRANT USAGE ON SCHEMA pii TO cpr_pii_app, cpr_pii_auditor;
