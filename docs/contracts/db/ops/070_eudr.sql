-- cpr_ops :: motor EUDR (W4)
-- Data de corte do Regulamento (UE) 2023/1115: 31/12/2020. O valor é
-- parâmetro da base de referência, não constante de código, porque a data
-- de aplicação do regulamento sofreu adiamentos e o MVP precisa sobreviver
-- a um novo. [#REF]

CREATE TABLE ops.base_referencia_geo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo        text NOT NULL,            -- 'PRODES', 'MAPBIOMAS_ALERTA', 'GFW_INTEGRATED'
  versao        text NOT NULL,
  data_corte    date NOT NULL DEFAULT DATE '2020-12-31',
  cobertura     text NOT NULL,
  publicada_em  date NOT NULL,
  -- SMC-010: resolução espacial da base, em metros. A faixa de incerteza do
  -- cruzamento não é uma constante escolhida a dedo: depende da resolução da
  -- base e do perímetro do talhão, porque o erro mora nas bordas.
  resolucao_m   integer NOT NULL DEFAULT 30 CHECK (resolucao_m > 0),
  ingerida_em   timestamptz NOT NULL DEFAULT now(),
  hash_dataset  ops.hash32 NOT NULL,      -- torna a evidência reproduzível (P6)
  UNIQUE (codigo, versao)
);

-- SMC-009 (aditiva): a geometria das bases de desmatamento precisa viver no
-- banco para que o cruzamento seja feito pelo PostGIS, e não por código de
-- aplicação. Cruzamento em memória não é auditável nem reproduzível.
CREATE TABLE geo.desmatamento (
  id            text NOT NULL,
  base_id       uuid NOT NULL REFERENCES ops.base_referencia_geo(id) ON DELETE CASCADE,
  ano_deteccao  integer NOT NULL,
  geometria     geometry(MultiPolygon, 4326) NOT NULL,
  ingerido_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (base_id, id)
);
CREATE INDEX ix_desmatamento_gist ON geo.desmatamento USING gist (geometria);
COMMENT ON TABLE geo.desmatamento IS
  'Polígonos de desmatamento por base e ano. O ano é comparado com a data de '
  'corte da base (31/12/2020), que é coluna e não constante: a aplicação do '
  'regulamento já foi adiada mais de uma vez.';

CREATE TABLE ops.evidencia_eudr (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  talhao_id         uuid NOT NULL REFERENCES ops.talhao(id),
  poligono_versao   integer NOT NULL,
  poligono_hash     ops.hash32 NOT NULL,
  leitura_id        uuid REFERENCES ops.leitura_oraculo(id),   -- quórum geoespacial (P4)
  resultado         ops.resultado_eudr NOT NULL,
  area_sobreposta_ha numeric(12,4) NOT NULL DEFAULT 0,
  margem_erro_m     integer NOT NULL,        -- resolução da base; define a faixa LIMITROFE
  bases             jsonb NOT NULL,          -- [{base_id, versao, resultado, area}]
  insumos_hash      ops.hash32 NOT NULL,     -- hash canônico dos insumos
  hash_evidencia    ops.hash32 NOT NULL UNIQUE,  -- hash do documento de evidência
  evidencia_uri     text NOT NULL,           -- armazenamento append-only
  gerada_em         timestamptz NOT NULL DEFAULT now(),
  valida_ate        timestamptz NOT NULL,    -- força reavaliação contínua
  CONSTRAINT limitrofe_tem_margem CHECK (resultado <> 'LIMITROFE' OR margem_erro_m > 0),
  CONSTRAINT conforme_sem_sobreposicao CHECK (resultado <> 'CONFORME' OR area_sobreposta_ha = 0)
);
CREATE INDEX ix_evidencia_talhao ON ops.evidencia_eudr (talhao_id, gerada_em DESC);
COMMENT ON TABLE ops.evidencia_eudr IS
  'A evidência é reproduzível a partir de (poligono_hash, bases, insumos_hash). '
  'Nenhum polígono bruto é persistido aqui nem publicado on-chain (P2).';

CREATE TABLE ops.dds (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id    uuid NOT NULL REFERENCES ops.contrato(id),
  numero         text NOT NULL UNIQUE,
  estado         ops.estado_dds NOT NULL DEFAULT 'RASCUNHO',
  evidencias     uuid[] NOT NULL,
  operador_ref   ops.ref_opaca NOT NULL,
  hash_dds       ops.hash32 NOT NULL,
  dds_uri        text NOT NULL,
  emitida_em     timestamptz,
  substituida_por uuid REFERENCES ops.dds(id),
  revogada_em    timestamptz,
  motivo_revogacao ops.texto_sem_pii,
  CONSTRAINT emitida_tem_data CHECK ((estado = 'EMITIDA') = (emitida_em IS NOT NULL))
);

-- Reavaliação contínua: o selo é atributo perecível do colateral.
CREATE TABLE ops.reavaliacao_eudr (
  id              bigserial PRIMARY KEY,
  talhao_id       uuid NOT NULL REFERENCES ops.talhao(id),
  evidencia_anterior uuid REFERENCES ops.evidencia_eudr(id),
  evidencia_nova  uuid NOT NULL REFERENCES ops.evidencia_eudr(id),
  mudou_resultado boolean NOT NULL,
  disparada_por   text NOT NULL,       -- AGENDA | ALERTA_FONTE | NOVO_POLIGONO
  executada_em    timestamptz NOT NULL DEFAULT now()
);
