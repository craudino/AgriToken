-- cpr_ops :: produtor e talhão
-- Nenhuma coluna identifica diretamente uma pessoa. O vínculo com a identidade
-- real existe apenas em cpr_pii e é resolvido por services/compliance.

CREATE TABLE ops.produtor (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_opaca         ops.ref_opaca NOT NULL UNIQUE,          -- único identificador que pode ir on-chain
  pii_ref           uuid NOT NULL UNIQUE,                   -- ponteiro para cpr_pii.titular; sem FK (base distinta)
  tipo_pessoa       char(2) NOT NULL CHECK (tipo_pessoa IN ('PF','PJ')),
  porte             ops.porte_produtor NOT NULL,
  uf                char(2) NOT NULL,
  municipio_ibge    char(7) NOT NULL,                       -- granularidade municipal; não é endereço
  situacao_kyc      ops.situacao_kyc NOT NULL DEFAULT 'NAO_INICIADO',
  kyc_valido_ate    date,
  did               text UNIQUE,                            -- did:web / did:key do titular (W5)
  criado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  eliminado_em      timestamptz,                            -- crypto-shredding executado em cpr_pii
  CONSTRAINT kyc_aprovado_tem_validade
    CHECK (situacao_kyc <> 'APROVADO' OR kyc_valido_ate IS NOT NULL)
);
COMMENT ON COLUMN ops.produtor.ref_opaca IS 'Pseudônimo aleatório; ver ADR-0002.';
COMMENT ON COLUMN ops.produtor.eliminado_em IS
  'Marca de eliminação do titular. A linha permanece porque o histórico '
  'contratual é obrigação legal; o que desaparece é a capacidade de '
  'reidentificar, pela destruição da chave em cpr_pii.';

CREATE INDEX ix_produtor_kyc ON ops.produtor (situacao_kyc, kyc_valido_ate);

-- ---------------------------------------------------------------------------
-- Talhão: atributo produtivo. A geometria bruta fica em geo.talhao_geometria,
-- em schema com papel próprio; ops.talhao carrega apenas metadado e hash.
-- ---------------------------------------------------------------------------
CREATE TABLE ops.talhao (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produtor_id        uuid NOT NULL REFERENCES ops.produtor(id),
  apelido            ops.texto_sem_pii,
  car_ref            uuid NOT NULL,                  -- número do CAR vive em cpr_pii (é reidentificante)
  car_hash           ops.hash32 NOT NULL,            -- sha256(numero_car normalizado + sal do titular)
  area_declarada_ha  numeric(12,4) NOT NULL CHECK (area_declarada_ha > 0),
  area_calculada_ha  numeric(12,4),                  -- derivada da geometria (A4)
  altitude_media_m   integer,
  commodity          ops.commodity NOT NULL,
  poligono_hash      ops.hash32,                     -- hash do polígono canonicalizado; o que vai on-chain
  poligono_versao    integer NOT NULL DEFAULT 0,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT area_coerente CHECK (
    area_calculada_ha IS NULL
    OR abs(area_calculada_ha - area_declarada_ha) <= 0.20 * area_declarada_ha
  )
);
COMMENT ON CONSTRAINT area_coerente ON ops.talhao IS
  'Divergência acima de 20% entre área declarada e área do polígono é sinal '
  'de erro de cadastro ou de polígono errado — E5 trata dado externo como '
  'suspeito por padrão.';

CREATE INDEX ix_talhao_produtor ON ops.talhao (produtor_id);

-- ---------------------------------------------------------------------------
-- Geometria bruta (schema restrito)
-- ---------------------------------------------------------------------------
CREATE TABLE geo.talhao_geometria (
  talhao_id     uuid NOT NULL,
  versao        integer NOT NULL,
  geometria     geometry(MultiPolygon, 4326) NOT NULL,
  origem        text NOT NULL,          -- 'SICAR', 'UPLOAD_KML', 'LEVANTAMENTO_CAMPO'
  ingerido_em   timestamptz NOT NULL DEFAULT now(),
  valido_topo   boolean NOT NULL,       -- ST_IsValid no momento da ingestão
  motivo_invalidez text,
  PRIMARY KEY (talhao_id, versao)
);
CREATE INDEX ix_geometria_gist ON geo.talhao_geometria USING gist (geometria);
COMMENT ON TABLE geo.talhao_geometria IS
  'Polígono georreferenciado bruto. Dado potencialmente reidentificante: '
  'nunca é publicado on-chain nem exposto por API pública (P2). On-chain '
  'circula somente ops.talhao.poligono_hash.';

-- Versão ofuscada para exibição a terceiros (centroide deslocado + área).
CREATE TABLE geo.talhao_ofuscado (
  talhao_id       uuid PRIMARY KEY,
  centroide_aprox geometry(Point, 4326) NOT NULL,   -- ruído >= 5 km
  raio_ruido_m    integer NOT NULL CHECK (raio_ruido_m >= 5000),
  gerado_em       timestamptz NOT NULL DEFAULT now()
);
