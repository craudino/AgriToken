-- cpr_audit :: registro de auditoria encadeado por hash (P5)
-- Formato canônico em docs/contracts/events/registro-auditoria.schema.json.

CREATE TABLE audit.registro (
  seq            bigserial PRIMARY KEY,
  id             uuid NOT NULL UNIQUE,
  tipo           text NOT NULL,
  versao         integer NOT NULL DEFAULT 1,
  sujeito_tipo   text NOT NULL,
  sujeito_id     text NOT NULL,          -- sempre identificador opaco
  ator_ref       text,                   -- pseudônimo; nunca nome de pessoa
  origem         text NOT NULL,          -- serviço, versão e instância
  ocorrido_em    timestamptz NOT NULL,
  registrado_em  timestamptz NOT NULL DEFAULT now(),
  payload        jsonb NOT NULL,
  evidencia      jsonb NOT NULL DEFAULT '[]',
  hash_anterior  bytea NOT NULL CHECK (octet_length(hash_anterior) = 32),
  hash           bytea NOT NULL UNIQUE CHECK (octet_length(hash) = 32),
  assinatura     bytea,
  CONSTRAINT payload_sem_cpf CHECK (
    payload::text !~ '(^|[^0-9])[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}([^0-9]|$)'
  ),
  CONSTRAINT payload_sem_email CHECK (
    payload::text !~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
  )
);
CREATE INDEX ix_registro_sujeito ON audit.registro (sujeito_tipo, sujeito_id, ocorrido_em DESC);
CREATE INDEX ix_registro_tipo ON audit.registro (tipo, ocorrido_em DESC);

-- Encadeamento: hash = sha256(hash_anterior || canonical(payload_relevante)).
CREATE OR REPLACE FUNCTION audit.fn_encadeia() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_anterior bytea;
BEGIN
  SELECT r.hash INTO v_anterior FROM audit.registro r ORDER BY r.seq DESC LIMIT 1;
  IF v_anterior IS NULL THEN
    v_anterior := decode(repeat('00', 32), 'hex');   -- bloco gênese
  END IF;
  NEW.hash_anterior := v_anterior;
  NEW.hash := digest(
    v_anterior
    || convert_to(NEW.id::text, 'UTF8')
    || convert_to(NEW.tipo, 'UTF8')
    || convert_to(NEW.sujeito_tipo || ':' || NEW.sujeito_id, 'UTF8')
    || convert_to(to_char(NEW.ocorrido_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USOF'), 'UTF8')
    || convert_to(jsonb_canonical(NEW.payload), 'UTF8'),
    'sha256');
  RETURN NEW;
END
$$;

-- Canonicalização determinística do JSON (P6): chaves ordenadas, sem espaços.
CREATE OR REPLACE FUNCTION jsonb_canonical(j jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE jsonb_typeof(j)
    WHEN 'object' THEN
      COALESCE((SELECT '{' || string_agg(to_json(k.key)::text || ':' || jsonb_canonical(j -> k.key), ',' ORDER BY k.key) || '}'
                  FROM jsonb_object_keys(j) AS k(key)), '{}')
    WHEN 'array' THEN
      COALESCE((SELECT '[' || string_agg(jsonb_canonical(e.value), ',' ORDER BY e.ord) || ']'
                  FROM jsonb_array_elements(j) WITH ORDINALITY AS e(value, ord)), '[]')
    ELSE j::text
  END
$$;

CREATE TRIGGER tg_encadeia
  BEFORE INSERT ON audit.registro
  FOR EACH ROW EXECUTE FUNCTION audit.fn_encadeia();

-- Append-only por construção, não por convenção.
CREATE OR REPLACE FUNCTION audit.fn_recusa_mutacao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit.registro e append-only (P5): % recusado', TG_OP;
END
$$;

CREATE TRIGGER tg_recusa_update BEFORE UPDATE ON audit.registro
  FOR EACH ROW EXECUTE FUNCTION audit.fn_recusa_mutacao();
CREATE TRIGGER tg_recusa_delete BEFORE DELETE ON audit.registro
  FOR EACH ROW EXECUTE FUNCTION audit.fn_recusa_mutacao();
CREATE TRIGGER tg_recusa_truncate BEFORE TRUNCATE ON audit.registro
  FOR EACH STATEMENT EXECUTE FUNCTION audit.fn_recusa_mutacao();

REVOKE UPDATE, DELETE, TRUNCATE ON audit.registro FROM PUBLIC;
GRANT INSERT, SELECT ON audit.registro TO cpr_audit_writer;
GRANT SELECT ON audit.registro TO cpr_audit_reader;

-- Verificação da cadeia: resultado vai ao painel de auditoria e ao CI.
CREATE OR REPLACE FUNCTION audit.verifica_cadeia(p_desde bigint DEFAULT 0)
RETURNS TABLE (seq bigint, ok boolean, motivo text)
LANGUAGE plpgsql AS $$
DECLARE r record; v_esperado bytea; v_anterior bytea;
BEGIN
  SELECT COALESCE((SELECT a.hash FROM audit.registro a WHERE a.seq = p_desde), decode(repeat('00',32),'hex'))
    INTO v_anterior;
  FOR r IN SELECT * FROM audit.registro WHERE audit.registro.seq > p_desde ORDER BY audit.registro.seq LOOP
    v_esperado := digest(
      v_anterior
      || convert_to(r.id::text, 'UTF8')
      || convert_to(r.tipo, 'UTF8')
      || convert_to(r.sujeito_tipo || ':' || r.sujeito_id, 'UTF8')
      || convert_to(to_char(r.ocorrido_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USOF'), 'UTF8')
      || convert_to(jsonb_canonical(r.payload), 'UTF8'),
      'sha256');
    seq := r.seq;
    ok := (v_esperado = r.hash AND v_anterior = r.hash_anterior);
    motivo := CASE WHEN ok THEN NULL ELSE 'hash divergente: registro alterado ou suprimido' END;
    RETURN NEXT;
    v_anterior := r.hash;
  END LOOP;
END
$$;
