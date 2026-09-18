-- cpr_ops :: papéis e schemas
-- Base operacional. Nenhuma coluna desta base pode conter dado pessoal
-- diretamente identificável (P2). Ver docs/contracts/db/README.md.

CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS geo;
CREATE SCHEMA IF NOT EXISTS sim;   -- simulador de registradora (Seção 6.2)

COMMENT ON SCHEMA ops IS 'Domínio operacional sem PII';
COMMENT ON SCHEMA geo IS 'Geometrias brutas; acesso restrito ao papel cpr_geo';
COMMENT ON SCHEMA sim IS 'Simulador de registradora; NUNCA promovido a produção';

-- Papéis. Criados sem LOGIN; as credenciais de aplicação herdam deles.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cpr_app')  THEN CREATE ROLE cpr_app  NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cpr_geo')  THEN CREATE ROLE cpr_geo  NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cpr_ro')   THEN CREATE ROLE cpr_ro   NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cpr_sim')  THEN CREATE ROLE cpr_sim  NOLOGIN; END IF;
END
$$;

GRANT USAGE ON SCHEMA ops TO cpr_app, cpr_ro;
GRANT USAGE ON SCHEMA geo TO cpr_geo;
GRANT USAGE ON SCHEMA sim TO cpr_sim;

-- O papel somente-leitura do painel de auditoria jamais enxerga geometria bruta.
REVOKE ALL ON SCHEMA geo FROM cpr_ro, cpr_app;
