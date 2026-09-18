-- cpr_ops :: oráculos, quórum, disputa e linhagem (W3)
-- P4: nenhuma decisão contratual materialmente relevante depende de uma única
-- fonte. O quórum é propriedade da política, verificada na base e no domínio.

CREATE TABLE ops.fonte_oraculo (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo         text NOT NULL UNIQUE,        -- 'CEPEA', 'B3', 'ICE', 'MAPBIOMAS', 'PRODES', ...
  tipo_leitura   ops.tipo_leitura NOT NULL,
  descricao      text NOT NULL,
  operador       text NOT NULL,               -- quem publica o dado
  url_referencia text,
  peso           numeric(5,4) NOT NULL DEFAULT 1 CHECK (peso > 0),
  ativa          boolean NOT NULL DEFAULT true,
  independente_de text[] NOT NULL DEFAULT '{}',
  criado_em      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN ops.fonte_oraculo.independente_de IS
  'Fontes com as quais esta NÃO é independente (ex.: dois agregadores que '
  'consomem o mesmo boletim). O quórum desconta correlação: duas fontes que '
  'copiam a mesma origem valem uma.';

CREATE TABLE ops.politica_quorum (
  tipo_leitura      ops.tipo_leitura PRIMARY KEY,
  criticidade       ops.criticidade_leitura NOT NULL,
  min_fontes        smallint NOT NULL CHECK (min_fontes >= 1),
  min_fontes_independentes smallint NOT NULL CHECK (min_fontes_independentes >= 1),
  desvio_max_pct    ops.pct NOT NULL,          -- dispersão tolerada entre fontes
  janela_validade   interval NOT NULL,         -- além disso, a leitura expira
  agregacao         text NOT NULL CHECK (agregacao IN ('MEDIANA','MEDIA_PONDERADA','UNANIMIDADE','INTERSECAO')),
  permite_degradado boolean NOT NULL DEFAULT false,
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contratual_exige_redundancia
    CHECK (criticidade <> 'CONTRATUAL' OR (min_fontes >= 2 AND min_fontes_independentes >= 2))
);
COMMENT ON CONSTRAINT contratual_exige_redundancia ON ops.politica_quorum IS
  'P4 codificado: é impossível configurar leitura contratual de fonte única.';

INSERT INTO ops.politica_quorum
  (tipo_leitura, criticidade, min_fontes, min_fontes_independentes, desvio_max_pct, janela_validade, agregacao, permite_degradado) VALUES
  ('PRECO',       'CONTRATUAL',  3, 2,  2.0000, interval '36 hours', 'MEDIANA',         true),
  ('GEOESPACIAL', 'CONTRATUAL',  2, 2,  5.0000, interval '90 days',  'INTERSECAO',      false),
  ('PAGAMENTO',   'CONTRATUAL',  2, 2,  0.0000, interval '7 days',   'UNANIMIDADE',     false),
  ('REGISTRO',    'CONTRATUAL',  2, 2,  0.0000, interval '24 hours', 'UNANIMIDADE',     false),
  ('FISCAL',      'CONTRATUAL',  2, 2,  0.0000, interval '30 days',  'UNANIMIDADE',     false),
  ('CLIMATICO',   'INFORMATIVA', 1, 1, 15.0000, interval '24 hours', 'MEDIA_PONDERADA', true);

-- Leitura agregada: a unidade que o domínio consome.
CREATE TABLE ops.leitura_oraculo (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_leitura      ops.tipo_leitura NOT NULL,
  chave             text NOT NULL,              -- 'CAFE_ARABICA/CEPEA-ESALQ/BRL-SACA', 'TALHAO/<id>'
  valor_numerico    numeric(24,8),
  valor_texto       ops.texto_sem_pii,
  valor_json        jsonb,
  unidade           text,
  referencia_em     timestamptz NOT NULL,       -- a que instante o dado se refere
  coletada_em       timestamptz NOT NULL DEFAULT now(),
  expira_em         timestamptz NOT NULL,
  estado            ops.estado_leitura NOT NULL DEFAULT 'COLETANDO',
  fontes_usadas     smallint NOT NULL DEFAULT 0,
  fontes_independentes smallint NOT NULL DEFAULT 0,
  dispersao_pct     ops.pct,
  politica_snapshot jsonb NOT NULL,             -- política vigente no momento (P6: reprodutibilidade)
  hash_linhagem     ops.hash32 NOT NULL,        -- hash da árvore de insumos
  CONSTRAINT efetiva_tem_quorum CHECK (
    estado NOT IN ('EFETIVA','DEGRADADA') OR fontes_independentes >= 1
  )
);
CREATE INDEX ix_leitura_chave ON ops.leitura_oraculo (tipo_leitura, chave, referencia_em DESC);
CREATE INDEX ix_leitura_estado ON ops.leitura_oraculo (estado) WHERE estado IN ('EM_DISPUTA','SEM_QUORUM','DEGRADADA');

-- Leitura por fonte: a linhagem começa aqui.
CREATE TABLE ops.leitura_fonte (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leitura_id      uuid NOT NULL REFERENCES ops.leitura_oraculo(id) ON DELETE CASCADE,
  fonte_id        uuid NOT NULL REFERENCES ops.fonte_oraculo(id),
  valor_numerico  numeric(24,8),
  valor_json      jsonb,
  bruto_hash      ops.hash32 NOT NULL,        -- hash do payload cru arquivado
  bruto_uri       text NOT NULL,              -- objeto no armazenamento append-only
  recebido_em     timestamptz NOT NULL DEFAULT now(),
  latencia_ms     integer,
  http_status     integer,
  assinatura      bytea,                      -- quando a fonte assina
  descartada      boolean NOT NULL DEFAULT false,
  motivo_descarte text,
  UNIQUE (leitura_id, fonte_id)
);
COMMENT ON COLUMN ops.leitura_fonte.bruto_uri IS
  'O payload cru é preservado. Sem ele, "de onde veio este número" não tem '
  'resposta auditável (P5) e a leitura não é reproduzível (P6).';

-- Disputa: suspende o efeito contratual da leitura, não a apaga.
CREATE TABLE ops.disputa_leitura (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leitura_id     uuid NOT NULL REFERENCES ops.leitura_oraculo(id),
  aberta_por_ref ops.ref_opaca NOT NULL,
  fundamento     ops.texto_sem_pii NOT NULL,
  evidencia      jsonb NOT NULL DEFAULT '[]',
  aberta_em      timestamptz NOT NULL DEFAULT now(),
  prazo_ate      timestamptz NOT NULL,
  resolucao      text CHECK (resolucao IN ('MANTIDA','SUBSTITUIDA','INVALIDADA')),
  leitura_substituta_id uuid REFERENCES ops.leitura_oraculo(id),
  resolvida_em   timestamptz,
  resolvida_por  text
);

-- Uso da leitura: qual decisão contratual consumiu qual leitura (P5).
CREATE TABLE ops.uso_leitura (
  leitura_id     uuid NOT NULL REFERENCES ops.leitura_oraculo(id),
  decisao_tipo   text NOT NULL,      -- MTM | GATILHO_INADIMPLENCIA | SELO_EUDR | LIQUIDACAO | CONCILIACAO
  decisao_id     uuid NOT NULL,
  usada_em       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (leitura_id, decisao_tipo, decisao_id)
);

-- Nenhuma decisão contratual consome leitura sem efeito.
CREATE OR REPLACE FUNCTION ops.fn_valida_uso_leitura() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_l record; v_p record;
BEGIN
  SELECT l.* INTO v_l FROM ops.leitura_oraculo l WHERE l.id = NEW.leitura_id;
  SELECT p.* INTO v_p FROM ops.politica_quorum p WHERE p.tipo_leitura = v_l.tipo_leitura;

  IF v_p.criticidade = 'INFORMATIVA' THEN
    RAISE EXCEPTION 'leitura informativa nao pode sustentar decisao contratual (P4)';
  END IF;
  IF v_l.estado NOT IN ('EFETIVA','DEGRADADA') THEN
    RAISE EXCEPTION 'leitura em estado % nao produz efeito contratual (P4)', v_l.estado;
  END IF;

  -- SMC-002. O ramo DEGRADADA era a porta dos fundos de P4: bastava marcar a
  -- leitura como degradada com uma fonte independente para sustentar decisão
  -- contratual, e daí até o gatilho de LTV e a excussão. Degradar pode reduzir
  -- o número total de fontes; nunca a redundância independente.
  IF v_l.fontes_independentes < v_p.min_fontes_independentes THEN
    RAISE EXCEPTION 'leitura com % fonte(s) independente(s); politica exige % (P4)',
      v_l.fontes_independentes, v_p.min_fontes_independentes;
  END IF;
  IF v_l.estado = 'EFETIVA' AND v_l.fontes_usadas < v_p.min_fontes THEN
    RAISE EXCEPTION 'leitura com % fonte(s); politica exige % (P4)',
      v_l.fontes_usadas, v_p.min_fontes;
  END IF;
  IF v_l.estado = 'DEGRADADA' AND NOT v_p.permite_degradado THEN
    RAISE EXCEPTION 'politica de % nao admite degradacao (P4)', v_l.tipo_leitura;
  END IF;
  IF v_l.expira_em <= now() THEN
    RAISE EXCEPTION 'leitura expirada em % nao produz efeito contratual (P4)', v_l.expira_em;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER tg_valida_uso_leitura
  BEFORE INSERT ON ops.uso_leitura
  FOR EACH ROW EXECUTE FUNCTION ops.fn_valida_uso_leitura();

-- SMC-002: e na origem. Marcar como EFETIVA ou DEGRADADA uma leitura que não
-- atinge o quórum da política é erro do adaptador, e erro de adaptador não
-- deve depender de quem consome para ser descoberto.
CREATE OR REPLACE FUNCTION ops.fn_valida_quorum_leitura() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_p record;
BEGIN
  IF NEW.estado NOT IN ('EFETIVA','DEGRADADA') THEN
    RETURN NEW;
  END IF;
  SELECT p.* INTO v_p FROM ops.politica_quorum p WHERE p.tipo_leitura = NEW.tipo_leitura;
  IF v_p.criticidade = 'CONTRATUAL' AND NEW.fontes_independentes < v_p.min_fontes_independentes THEN
    RAISE EXCEPTION 'leitura % nao atinge quorum independente da politica (% < %) (P4)',
      NEW.tipo_leitura, NEW.fontes_independentes, v_p.min_fontes_independentes;
  END IF;
  IF NEW.estado = 'DEGRADADA' AND NOT v_p.permite_degradado THEN
    RAISE EXCEPTION 'politica de % nao admite degradacao (P4)', NEW.tipo_leitura;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tg_valida_quorum_leitura
  BEFORE INSERT OR UPDATE ON ops.leitura_oraculo
  FOR EACH ROW EXECUTE FUNCTION ops.fn_valida_quorum_leitura();

-- Marcação a mercado (F5)
CREATE TABLE ops.marcacao_mercado (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id    uuid NOT NULL REFERENCES ops.contrato(id),
  leitura_id     uuid NOT NULL REFERENCES ops.leitura_oraculo(id),
  preco_saca     ops.valor_brl NOT NULL,
  haircut_pct    ops.pct NOT NULL,
  valor_mtm      ops.valor_brl NOT NULL,
  ltv_pct        ops.pct NOT NULL,
  calculada_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_mtm_contrato ON ops.marcacao_mercado (contrato_id, calculada_em DESC);
