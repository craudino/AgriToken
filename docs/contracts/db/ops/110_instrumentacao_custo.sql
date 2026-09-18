-- cpr_ops :: instrumentação de custo (SMC-007)
-- E6 apontou em G1 que seis das oito lacunas da Seção 1.1 são lacunas de custo
-- ou de disposição a pagar, e que o repositório tinha um único placar — o da
-- conciliação. Sem estas tabelas, o dossiê de G4 poderia responder de forma
-- verificável sobre F3 e teria de narrar as demais.
--
-- A unidade é a etapa de verificação: quem verificou o quê, quanto tempo levou,
-- quanto custou em tarifa externa, e se foi automática ou humana.

CREATE TYPE ops.etapa_verificacao AS ENUM (
  'KYC_DOCUMENTO', 'KYC_LISTAS', 'CAR_SICAR', 'POLIGONO_INGESTAO',
  'POLIGONO_VALIDACAO', 'EUDR_CRUZAMENTO', 'EUDR_EVIDENCIA', 'DDS_EMISSAO',
  'REGISTRO_CONSULTA', 'CONCILIACAO_CICLO', 'PRECO_COLETA', 'PAGAMENTO_CONFIRMACAO',
  'AVERBACAO_GARANTIA', 'ANALISE_HUMANA'
);

CREATE TABLE ops.custo_verificacao (
  id              bigserial PRIMARY KEY,
  etapa           ops.etapa_verificacao NOT NULL,
  sujeito_tipo    text NOT NULL CHECK (sujeito_tipo IN ('PRODUTOR','TALHAO','CONTRATO','GARANTIA','PLATAFORMA')),
  sujeito_id      uuid NOT NULL,
  automatica      boolean NOT NULL,
  esforco_humano_seg integer NOT NULL DEFAULT 0 CHECK (esforco_humano_seg >= 0),
  duracao_ms      integer NOT NULL CHECK (duracao_ms >= 0),
  tarifa_centavos integer NOT NULL DEFAULT 0 CHECK (tarifa_centavos >= 0),
  fonte           text,                    -- provedor cobrado, quando houver
  tentativas      smallint NOT NULL DEFAULT 1,
  sucesso         boolean NOT NULL,
  ocorrido_em     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automatica_sem_esforco_humano
    CHECK (NOT automatica OR esforco_humano_seg = 0)
);
CREATE INDEX ix_custo_sujeito ON ops.custo_verificacao (sujeito_tipo, sujeito_id);
CREATE INDEX ix_custo_etapa   ON ops.custo_verificacao (etapa, ocorrido_em DESC);

COMMENT ON TABLE ops.custo_verificacao IS
  'F1 é "custo real de verificação por produtor" e F4 é "custo e viabilidade '
  'do selo". Sem registrar o custo no momento em que ele ocorre, essas duas '
  'lacunas só teriam resposta narrada.';
COMMENT ON COLUMN ops.custo_verificacao.tentativas IS
  'Retentativa é custo. Uma fonte que só responde na terceira chamada custa '
  'três vezes, e é isso que aparece na fatura.';

-- Custo por produtor: a resposta verificável de F1.
CREATE VIEW ops.vw_custo_por_produtor AS
  SELECT p.id AS produtor_id,
         p.porte,
         count(*) FILTER (WHERE c.etapa IN ('KYC_DOCUMENTO','KYC_LISTAS','CAR_SICAR')) AS etapas_kyc,
         sum(c.tarifa_centavos)                                        AS tarifa_total_centavos,
         sum(c.esforco_humano_seg)                                     AS esforco_humano_seg,
         round(100.0 * count(*) FILTER (WHERE c.automatica) / nullif(count(*),0), 1) AS pct_automatico,
         count(*) FILTER (WHERE NOT c.sucesso)                         AS falhas
    FROM ops.produtor p
    LEFT JOIN ops.custo_verificacao c
           ON c.sujeito_tipo = 'PRODUTOR' AND c.sujeito_id = p.id
   GROUP BY p.id, p.porte;

-- Custo do selo EUDR por talhão: a resposta verificável de F4.
CREATE VIEW ops.vw_custo_selo_eudr AS
  SELECT t.id AS talhao_id,
         t.area_declarada_ha,
         sum(c.tarifa_centavos)     AS tarifa_total_centavos,
         sum(c.esforco_humano_seg)  AS esforco_humano_seg,
         sum(c.duracao_ms)          AS duracao_total_ms,
         count(*) FILTER (WHERE c.etapa = 'EUDR_CRUZAMENTO') AS cruzamentos,
         round(sum(c.tarifa_centavos) / nullif(t.area_declarada_ha, 0), 2) AS centavos_por_hectare
    FROM ops.talhao t
    LEFT JOIN ops.custo_verificacao c
           ON c.sujeito_tipo = 'TALHAO' AND c.sujeito_id = t.id
   GROUP BY t.id, t.area_declarada_ha;

-- F7: disposição a pagar do lado credor. Reação revelada, não opinião.
CREATE TABLE ops.reacao_credor (
  id            bigserial PRIMARY KEY,
  contrato_id   uuid NOT NULL REFERENCES ops.contrato(id),
  credor_ref    ops.ref_opaca NOT NULL,
  acao          text NOT NULL CHECK (acao IN ('VISUALIZOU','SOLICITOU_EVIDENCIA','OFERTOU','RECUSOU','RETIROU_OFERTA')),
  taxa_ofertada_pct ops.pct,
  prazo_ofertado_dias integer,
  motivo_recusa text CHECK (motivo_recusa IN (
    'EVIDENCIA_INSUFICIENTE','SELO_AUSENTE_OU_LIMITROFE','DIVERGENCIA_ABERTA',
    'GARANTIA_NAO_OPONIVEL','PRECO_OU_LTV','FORA_DA_POLITICA','OUTRO')),
  ocorrido_em   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recusa_tem_motivo CHECK ((acao = 'RECUSOU') = (motivo_recusa IS NOT NULL)),
  CONSTRAINT oferta_tem_taxa   CHECK ((acao = 'OFERTOU') = (taxa_ofertada_pct IS NOT NULL))
);
CREATE INDEX ix_reacao_contrato ON ops.reacao_credor (contrato_id, ocorrido_em DESC);

COMMENT ON TABLE ops.reacao_credor IS
  'A lacuna F7 é disposição a pagar. Painel bonito não a mede; taxa ofertada, '
  'recusa e motivo medem. O motivo é categórico de propósito: "evidência '
  'insuficiente" e "divergência aberta" dizem à engenharia o que faltou.';
