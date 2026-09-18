-- cpr_ops :: extensões
CREATE EXTENSION IF NOT EXISTS postgis;        -- geometria (A4)
CREATE EXTENSION IF NOT EXISTS pgcrypto;       -- gen_random_uuid, digest
CREATE EXTENSION IF NOT EXISTS btree_gist;     -- restrições de exclusão temporais
