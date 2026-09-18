-- cpr_ops :: conciliação contínua registro <-> token (W2, lacuna nº 1)
-- P1 é o eixo: o registro prevalece, sempre. Não existe nesta base nenhum
-- caminho que escreva em ops.contrato.registro_* a partir do estado on-chain.

-- Instantâneo do que a registradora afirmou.
CREATE TABLE ops.snapshot_registro (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id   uuid REFERENCES ops.contrato(id),      -- nulo se registro órfão
  registro_entidade text NOT NULL,
  registro_id   text NOT NULL,
  conteudo      jsonb NOT NULL,        -- resposta normalizada da registradora
  conteudo_hash ops.hash32 NOT NULL,
  origem_uri    text NOT NULL,         -- payload cru arquivado
  obtido_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_snap_registro ON ops.snapshot_registro (registro_entidade, registro_id, obtido_em DESC);

-- Instantâneo do estado on-chain.
CREATE TABLE ops.snapshot_onchain (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id   uuid REFERENCES ops.contrato(id),      -- nulo se token órfão
  chain_id      integer NOT NULL,
  contrato_addr bytea NOT NULL CHECK (octet_length(contrato_addr) = 20),
  token_id      numeric(78,0),
  bloco         bigint NOT NULL,
  bloco_hash    ops.hash32 NOT NULL,
  conteudo      jsonb NOT NULL,
  conteudo_hash ops.hash32 NOT NULL,
  obtido_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_snap_onchain ON ops.snapshot_onchain (chain_id, contrato_addr, token_id, bloco DESC);

-- Execução do ciclo de conciliação.
CREATE TABLE ops.conciliacao_execucao (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iniciada_em       timestamptz NOT NULL DEFAULT now(),
  concluida_em      timestamptz,
  escopo            text NOT NULL,        -- COMPLETA | INCREMENTAL | CONTRATO
  contratos_lidos   integer NOT NULL DEFAULT 0,
  divergencias_abertas integer NOT NULL DEFAULT 0,
  duracao_ms        integer,
  falhou            boolean NOT NULL DEFAULT false,
  erro              text
);

-- Divergência detectada. 'detectada_em' menos 'ocorrida_em' é o tempo de
-- detecção exigido pelo aceite de W2 — a métrica, não a promessa.
CREATE TABLE ops.divergencia (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execucao_id       uuid NOT NULL REFERENCES ops.conciliacao_execucao(id),
  contrato_id       uuid REFERENCES ops.contrato(id),
  tipo              ops.tipo_divergencia NOT NULL,
  severidade        ops.severidade NOT NULL,
  estado            ops.estado_divergencia NOT NULL DEFAULT 'ABERTA',
  campo             text,                  -- campo divergente, quando aplicável
  valor_registro    jsonb,                 -- o que o registro diz (prevalece)
  valor_onchain     jsonb,                 -- o que o token diz
  snapshot_registro_id uuid REFERENCES ops.snapshot_registro(id),
  snapshot_onchain_id  uuid REFERENCES ops.snapshot_onchain(id),
  ocorrida_em       timestamptz,           -- quando o fato aconteceu na origem
  detectada_em      timestamptz NOT NULL DEFAULT now(),
  latencia_deteccao_ms bigint GENERATED ALWAYS AS
    (CASE WHEN ocorrida_em IS NULL THEN NULL
          ELSE (EXTRACT(epoch FROM (detectada_em - ocorrida_em)) * 1000)::bigint END) STORED,
  congelou_contrato boolean NOT NULL DEFAULT false,
  incidente_id      uuid,
  reconciliada_em   timestamptz,
  -- SMC-001: identificador funcional do operador humano, com forma verificável.
  -- 'reconciliada_por text NOT NULL' aceitava a string 'bot'.
  reconciliada_por  text CHECK (reconciliada_por ~ '^OP-[A-Z0-9-]{3,}$'),
  reconciliacao_nota ops.texto_sem_pii,
  reconciliacao_justificativa_hash ops.hash32,
  CONSTRAINT critica_congela CHECK (severidade <> 'CRITICA' OR congelou_contrato),
  CONSTRAINT reconciliacao_tem_autor
    CHECK ((estado IN ('RECONCILIADA','FALSO_POSITIVO')) = (reconciliada_por IS NOT NULL)),
  CONSTRAINT reconciliacao_tem_justificativa
    CHECK ((estado IN ('RECONCILIADA','FALSO_POSITIVO')) = (reconciliacao_justificativa_hash IS NOT NULL))
);
CREATE INDEX ix_divergencia_aberta ON ops.divergencia (estado, severidade) WHERE estado = 'ABERTA';
CREATE INDEX ix_divergencia_contrato ON ops.divergencia (contrato_id, detectada_em DESC);

COMMENT ON CONSTRAINT critica_congela ON ops.divergencia IS
  'P1 executável: divergência crítica sem congelamento é estado impossível.';
COMMENT ON COLUMN ops.divergencia.reconciliada_por IS
  'Sempre humano identificado. Reconciliação automática é vedada por P1.';

-- Severidade por tipo: tabela, não if-else espalhado pelo código.
CREATE TABLE ops.politica_divergencia (
  tipo            ops.tipo_divergencia PRIMARY KEY,
  severidade      ops.severidade NOT NULL,
  congela         boolean NOT NULL,
  sla_deteccao    interval NOT NULL,
  acao            text NOT NULL
);

INSERT INTO ops.politica_divergencia (tipo, severidade, congela, sla_deteccao, acao) VALUES
  ('TITULO_BAIXADO_NO_REGISTRO',     'CRITICA', true,  interval '15 minutes', 'CONGELAR_E_ABRIR_INCIDENTE'),
  ('CESSAO_NAO_REFLETIDA',           'CRITICA', true,  interval '15 minutes', 'CONGELAR_E_ABRIR_INCIDENTE'),
  ('VALOR_FACE_ALTERADO',            'CRITICA', true,  interval '15 minutes', 'CONGELAR_E_ABRIR_INCIDENTE'),
  ('QUANTIDADE_ALTERADA',            'CRITICA', true,  interval '15 minutes', 'CONGELAR_E_ABRIR_INCIDENTE'),
  ('VENCIMENTO_ALTERADO',            'ALTA',    true,  interval '1 hour',     'CONGELAR_E_ABRIR_INCIDENTE'),
  ('GARANTIA_ALTERADA',              'ALTA',    true,  interval '1 hour',     'CONGELAR_E_ABRIR_INCIDENTE'),
  ('ONUS_OU_GRAVAME_NAO_REFLETIDO',  'CRITICA', true,  interval '15 minutes', 'CONGELAR_E_ABRIR_INCIDENTE'),
  ('TITULO_INEXISTENTE_NO_REGISTRO', 'CRITICA', true,  interval '15 minutes', 'CONGELAR_E_ESCALAR'),
  ('TOKEN_AUSENTE_PARA_REGISTRO',    'MEDIA',   false, interval '6 hours',    'ABRIR_INCIDENTE'),
  ('DUPLICIDADE_DE_ANCORA',          'CRITICA', true,  interval '1 minute',   'CONGELAR_AMBOS_E_ESCALAR'),
  ('TRANSFERENCIA_SEM_CESSAO',       'CRITICA', true,  interval '5 minutes',  'CONGELAR_E_ESCALAR'),
  ('FRACIONAMENTO_NAO_REFLETIDO',    'CRITICA', true,  interval '5 minutes',  'CONGELAR_E_ESCALAR'),
  ('ESTADO_DIVERGENTE',              'ALTA',    true,  interval '1 hour',     'CONGELAR_E_ABRIR_INCIDENTE'),
  ('HASH_DOCUMENTAL_DIVERGENTE',     'ALTA',    true,  interval '1 hour',     'CONGELAR_E_ABRIR_INCIDENTE');

CREATE TABLE ops.incidente (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origem        text NOT NULL,        -- CONCILIACAO | ORACULO | EUDR | PLATAFORMA
  severidade    ops.severidade NOT NULL,
  titulo        ops.texto_sem_pii NOT NULL,
  descricao     ops.texto_sem_pii NOT NULL,
  contrato_id   uuid REFERENCES ops.contrato(id),
  aberto_em     timestamptz NOT NULL DEFAULT now(),
  fechado_em    timestamptz,
  responsavel   text,
  resolucao     ops.texto_sem_pii
);

ALTER TABLE ops.divergencia
  ADD CONSTRAINT fk_divergencia_incidente FOREIGN KEY (incidente_id) REFERENCES ops.incidente(id);

-- SMC-001: fecha o ciclo. A transição de saída do congelamento aponta para a
-- divergência reconciliada, e a FK torna impossível apontar para o vazio.
ALTER TABLE ops.contrato_transicao
  ADD CONSTRAINT fk_transicao_divergencia FOREIGN KEY (divergencia_id) REFERENCES ops.divergencia(id);

-- ---------------------------------------------------------------------------
-- Simulador de registradora (Seção 6.2). Schema separado e papel separado:
-- o simulador é fonte externa, não parte do domínio.
-- ---------------------------------------------------------------------------
CREATE TABLE sim.titulo (
  registro_entidade text NOT NULL,
  registro_id       text NOT NULL,
  conteudo          jsonb NOT NULL,
  versao            integer NOT NULL DEFAULT 1,
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (registro_entidade, registro_id)
);

CREATE TABLE sim.injecao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo          ops.tipo_divergencia NOT NULL,
  registro_entidade text NOT NULL,
  registro_id   text NOT NULL,
  parametros    jsonb NOT NULL DEFAULT '{}',
  injetada_em   timestamptz NOT NULL DEFAULT now(),
  detectada_divergencia_id uuid,   -- preenchido pelo teste de aceite
  detectada_em  timestamptz,
  latencia_ms   bigint
);
COMMENT ON TABLE sim.injecao IS
  'Cada injeção é uma pergunta ao sistema. A tabela é o placar do teste de '
  'aceite mais importante do MVP: doze tipos injetados, doze detectados, com '
  'latência medida.';
