-- cpr_ops :: garantias e waterfall de cinco níveis (F6, W8)

-- Parametrização dos cinco níveis. É configuração versionada, não constante
-- de código: E4 precisa recalibrar sem redeploy.
CREATE TABLE ops.waterfall_politica (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rotulo         text NOT NULL,
  versao         integer NOT NULL,
  vigente_de     timestamptz NOT NULL DEFAULT now(),
  vigente_ate    timestamptz,
  UNIQUE (rotulo, versao)
);

CREATE TABLE ops.waterfall_nivel (
  politica_id        uuid NOT NULL REFERENCES ops.waterfall_politica(id) ON DELETE CASCADE,
  nivel              smallint NOT NULL CHECK (nivel BETWEEN 1 AND 5),
  rotulo             text NOT NULL,
  descricao          text NOT NULL,
  gatilho            text NOT NULL,                 -- expressão avaliada pelo motor de simulação
  cap_pct_exposicao  ops.pct,                       -- teto de absorção do nível
  prazo_recuperacao_dias integer NOT NULL CHECK (prazo_recuperacao_dias >= 0),
  haircut_pct        ops.pct NOT NULL DEFAULT 0,    -- deságio esperado na excussão
  PRIMARY KEY (politica_id, nivel)
);
COMMENT ON COLUMN ops.waterfall_nivel.prazo_recuperacao_dias IS
  'Tempo estimado até caixa, por nível. É a variável que E4 cobra: garantia '
  'que recupera em 900 dias não é garantia, é esperança contabilizada.';

CREATE TABLE ops.garantia (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id        uuid NOT NULL REFERENCES ops.contrato(id),
  tipo               ops.tipo_garantia NOT NULL,
  nivel_waterfall    smallint NOT NULL CHECK (nivel_waterfall BETWEEN 1 AND 5),
  descricao          ops.texto_sem_pii,
  valor_declarado    ops.valor_brl NOT NULL,
  valor_avaliado     ops.valor_brl,
  avaliacao_leitura_id uuid,                        -- FK lógica p/ ops.leitura_oraculo
  registro_publico_ref ops.texto_sem_pii,           -- matrícula/averbação (sem nome de pessoa)
  talhao_id          uuid REFERENCES ops.talhao(id),
  estado_excussao    ops.estado_excussao NOT NULL DEFAULT 'NAO_ACIONADA',
  vinculada_em       timestamptz NOT NULL DEFAULT now(),
  liberada_em        timestamptz,
  CONSTRAINT penhor_safra_tem_talhao
    CHECK (tipo <> 'PENHOR_SAFRA' OR talhao_id IS NOT NULL)
);
CREATE INDEX ix_garantia_contrato ON ops.garantia (contrato_id);

-- P3 aplicado à garantia real: o mesmo bem não lastreia dois contratos vivos.
CREATE UNIQUE INDEX uq_garantia_bem_ativo
  ON ops.garantia (tipo, registro_publico_ref)
  WHERE liberada_em IS NULL AND registro_publico_ref IS NOT NULL;
CREATE UNIQUE INDEX uq_garantia_talhao_ativo
  ON ops.garantia (talhao_id)
  WHERE liberada_em IS NULL AND tipo = 'PENHOR_SAFRA';

-- ---------------------------------------------------------------------------
-- Simulação do waterfall (W8). Determinística e reprodutível (P6): a mesma
-- semente e a mesma política produzem o mesmo resultado, byte a byte.
-- ---------------------------------------------------------------------------
CREATE TABLE ops.simulacao_waterfall (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  politica_id     uuid NOT NULL REFERENCES ops.waterfall_politica(id),
  cenario         text NOT NULL,          -- INADIMPLENCIA_ISOLADA | QUEBRA_SISTEMICA | QUEDA_PRECO_EXCUSSAO
  parametros      jsonb NOT NULL,         -- choque de preço, % de inadimplência, etc.
  semente         bigint NOT NULL,
  escopo_contratos uuid[] NOT NULL,
  exposicao_total ops.valor_brl NOT NULL,
  perda_bruta     ops.valor_brl NOT NULL,
  perda_residual  ops.valor_brl NOT NULL, -- o que sobra depois dos cinco níveis
  hash_resultado  ops.hash32 NOT NULL,    -- reprodutibilidade verificável
  executada_em    timestamptz NOT NULL DEFAULT now(),
  executada_por   text NOT NULL
);

CREATE TABLE ops.simulacao_nivel_resultado (
  simulacao_id    uuid NOT NULL REFERENCES ops.simulacao_waterfall(id) ON DELETE CASCADE,
  nivel           smallint NOT NULL CHECK (nivel BETWEEN 1 AND 5),
  absorvido       ops.valor_brl NOT NULL,
  esgotado        boolean NOT NULL,
  recuperacao_dias_p50 integer NOT NULL,
  recuperacao_dias_p90 integer NOT NULL,
  observacao      ops.texto_sem_pii,
  PRIMARY KEY (simulacao_id, nivel),
  CONSTRAINT p90_nao_menor CHECK (recuperacao_dias_p90 >= recuperacao_dias_p50)
);

-- Evento de inadimplência observado (não simulado)
CREATE TABLE ops.evento_inadimplencia (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id    uuid NOT NULL REFERENCES ops.contrato(id),
  gatilho        text NOT NULL,          -- VENCIMENTO_SEM_PAGAMENTO | LTV_ROMPIDO | SELO_PERDIDO
  detectado_em   timestamptz NOT NULL DEFAULT now(),
  leituras       uuid[] NOT NULL DEFAULT '{}',   -- leituras de oráculo que sustentam o gatilho
  simulacao_id   uuid REFERENCES ops.simulacao_waterfall(id)
);
