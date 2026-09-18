-- cpr_ops :: caixa de saída de eventos (outbox)
-- O envelope segue docs/contracts/events/envelope.schema.json. A base guarda
-- o evento; o publicador o entrega ao barramento e à trilha de auditoria.

CREATE TABLE ops.evento (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo           text NOT NULL,                 -- ver catalogo.json
  versao         integer NOT NULL DEFAULT 1,
  sujeito_tipo   text NOT NULL,                 -- CONTRATO | TALHAO | LEITURA | DDS | PRODUTOR
  sujeito_id     uuid NOT NULL,
  correlacao_id  uuid NOT NULL,
  causa_id       uuid,                          -- evento que causou este
  ator_ref       ops.ref_opaca,
  origem         text NOT NULL,
  ocorrido_em    timestamptz NOT NULL,
  registrado_em  timestamptz NOT NULL DEFAULT now(),
  payload        jsonb NOT NULL,
  evidencia      jsonb NOT NULL DEFAULT '[]',
  payload_hash   ops.hash32 NOT NULL,
  publicado_em   timestamptz,
  tentativas     smallint NOT NULL DEFAULT 0,
  CONSTRAINT ocorrido_nao_futuro CHECK (ocorrido_em <= registrado_em + interval '5 minutes')
);
CREATE INDEX ix_evento_pendente ON ops.evento (registrado_em) WHERE publicado_em IS NULL;
CREATE INDEX ix_evento_sujeito  ON ops.evento (sujeito_tipo, sujeito_id, ocorrido_em DESC);
CREATE INDEX ix_evento_correlacao ON ops.evento (correlacao_id);

-- Evento é imutável depois de registrado: só 'publicado_em' e 'tentativas' mudam.
CREATE OR REPLACE FUNCTION ops.fn_evento_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.tipo, NEW.payload, NEW.ocorrido_em, NEW.payload_hash)
     IS DISTINCT FROM (OLD.id, OLD.tipo, OLD.payload, OLD.ocorrido_em, OLD.payload_hash) THEN
    RAISE EXCEPTION 'evento e imutavel (P5)';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tg_evento_imutavel
  BEFORE UPDATE ON ops.evento
  FOR EACH ROW EXECUTE FUNCTION ops.fn_evento_imutavel();

CREATE RULE r_evento_sem_delete AS ON DELETE TO ops.evento DO INSTEAD NOTHING;
