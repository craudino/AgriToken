-- cpr_ops :: contrato espelhado e máquina de estados
-- P1: o registro prevalece. As colunas 'registro_*' são cópia do que a
-- entidade registradora afirma; as colunas 'token_*' descrevem o espelho.
-- Nenhum caminho de escrita deriva 'registro_*' a partir de 'token_*'.

CREATE TABLE ops.contrato (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- fonte de verdade (registradora)
  registro_id           text NOT NULL,                 -- identificador na entidade autorizada
  registro_entidade     text NOT NULL,                 -- código da registradora
  registro_hash_ancora  ops.hash32 NOT NULL,           -- keccak256(entidade || registro_id): o que ancora on-chain
  registro_documento_hash ops.hash32,                  -- hash do título registrado
  registrado_em         timestamptz,

  -- partes (referências opacas)
  produtor_id           uuid NOT NULL REFERENCES ops.produtor(id),
  credor_ref            ops.ref_opaca,                 -- titular atual segundo o REGISTRO

  -- termos econômicos
  commodity             ops.commodity NOT NULL,
  quantidade_sacas      ops.sacas NOT NULL,
  safra                 text NOT NULL CHECK (safra ~ '^[0-9]{4}/[0-9]{4}$'),
  vencimento            date NOT NULL,
  valor_face            ops.valor_brl NOT NULL,
  moeda                 char(3) NOT NULL DEFAULT 'BRL' CHECK (moeda = 'BRL'),

  -- espelho
  token_chain_id        integer,
  token_contrato_addr   bytea CHECK (token_contrato_addr IS NULL OR octet_length(token_contrato_addr) = 20),
  token_id              numeric(78,0),                 -- uint256 ERC-3525
  token_slot            numeric(78,0),
  espelhado_em          timestamptz,
  espelhado_tx          ops.hash32,

  -- estado
  estado                ops.estado_contrato NOT NULL DEFAULT 'RASCUNHO',
  situacao_conciliacao  ops.situacao_conciliacao NOT NULL DEFAULT 'NAO_APLICAVEL',
  congelado_em          timestamptz,
  congelado_motivo      ops.texto_sem_pii,

  -- marcação a mercado (último valor efetivo; histórico em ops.marcacao_mercado)
  valor_mtm             ops.valor_brl,
  valor_mtm_em          timestamptz,

  -- EUDR (derivado; a evidência canônica está em ops.evidencia_eudr)
  selo_eudr             ops.resultado_eudr,
  selo_eudr_em          timestamptz,

  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now(),

  -- P3: unicidade do colateral. Um registro, uma âncora, um espelho.
  CONSTRAINT uq_registro UNIQUE (registro_entidade, registro_id),
  CONSTRAINT uq_ancora   UNIQUE (registro_hash_ancora),
  CONSTRAINT uq_token    UNIQUE (token_chain_id, token_contrato_addr, token_id),

  CONSTRAINT espelho_completo CHECK (
    (token_id IS NULL AND token_chain_id IS NULL AND token_contrato_addr IS NULL)
    OR (token_id IS NOT NULL AND token_chain_id IS NOT NULL AND token_contrato_addr IS NOT NULL)
  ),
  CONSTRAINT estado_exige_espelho CHECK (
    estado NOT IN ('ESPELHADO','ATIVO','EM_DISPUTA','INADIMPLENTE','LIQUIDADO','EXECUTADO')
    OR token_id IS NOT NULL
  ),
  CONSTRAINT congelamento_coerente CHECK (
    (situacao_conciliacao = 'CONGELADO') = (congelado_em IS NOT NULL)
  ),
  CONSTRAINT vencimento_apos_registro CHECK (registrado_em IS NULL OR vencimento > registrado_em::date)
);

CREATE INDEX ix_contrato_estado       ON ops.contrato (estado);
CREATE INDEX ix_contrato_conciliacao  ON ops.contrato (situacao_conciliacao) WHERE situacao_conciliacao <> 'CONCILIADO';
CREATE INDEX ix_contrato_produtor     ON ops.contrato (produtor_id);
CREATE INDEX ix_contrato_vencimento   ON ops.contrato (vencimento);

COMMENT ON COLUMN ops.contrato.registro_hash_ancora IS
  'Âncora on-chain. Determinística por exigência de idempotência (P3): a '
  'segunda tentativa de emissão para o mesmo registro precisa colidir. '
  'Identificador de título não é dado pessoal; ver ADR-0002, seção riscos.';
COMMENT ON COLUMN ops.contrato.valor_mtm IS
  'Valor marcado a mercado. Só é atualizado a partir de leitura de oráculo '
  'em estado EFETIVA ou DEGRADADA; leitura EM_DISPUTA não move MTM (P4).';

-- ---------------------------------------------------------------------------
-- Vínculo contrato <-> talhão (lastro produtivo e base do selo EUDR)
-- ---------------------------------------------------------------------------
CREATE TABLE ops.contrato_talhao (
  contrato_id  uuid NOT NULL REFERENCES ops.contrato(id) ON DELETE RESTRICT,
  talhao_id    uuid NOT NULL REFERENCES ops.talhao(id)   ON DELETE RESTRICT,
  sacas_alocadas ops.sacas NOT NULL,
  PRIMARY KEY (contrato_id, talhao_id)
);

-- ---------------------------------------------------------------------------
-- Máquina de estados explícita (Briefing 6.1). A tabela de transições
-- permitidas é dado, não código: o mesmo grafo vale para o domínio TypeScript
-- e para a base, e as duas cópias são comparadas em CI (teste de contrato).
-- ---------------------------------------------------------------------------
CREATE TABLE ops.transicao_permitida (
  de     ops.estado_contrato NOT NULL,
  para   ops.estado_contrato NOT NULL,
  guarda text NOT NULL,      -- nome da guarda avaliada no domínio
  PRIMARY KEY (de, para)
);

INSERT INTO ops.transicao_permitida (de, para, guarda) VALUES
  ('RASCUNHO',      'EM_VERIFICACAO', 'dados_minimos_preenchidos'),
  ('EM_VERIFICACAO','RASCUNHO',       'verificacao_reprovada'),
  ('EM_VERIFICACAO','REGISTRADO',     'registro_confirmado_pela_entidade'),
  ('REGISTRADO',    'ESPELHADO',      'ancora_unica_e_emissao_confirmada'),
  ('ESPELHADO',     'ATIVO',          'conciliacao_inicial_conforme'),
  ('ATIVO',         'EM_DISPUTA',     'divergencia_critica_ou_contestacao'),
  ('ATIVO',         'INADIMPLENTE',   'vencido_sem_liquidacao'),
  ('ATIVO',         'LIQUIDADO',      'pagamento_conciliado_e_baixa_no_registro'),
  ('EM_DISPUTA',    'ATIVO',          'divergencia_reconciliada'),
  ('EM_DISPUTA',    'INADIMPLENTE',   'disputa_resolvida_contra_devedor'),
  ('EM_DISPUTA',    'EXECUTADO',      'decisao_de_excussao'),
  ('INADIMPLENTE',  'LIQUIDADO',      'pagamento_conciliado_e_baixa_no_registro'),
  ('INADIMPLENTE',  'EXECUTADO',      'waterfall_percorrido'),
  ('INADIMPLENTE',  'EM_DISPUTA',     'contestacao_do_devedor');

CREATE TABLE ops.contrato_transicao (
  id            bigserial PRIMARY KEY,
  contrato_id   uuid NOT NULL REFERENCES ops.contrato(id),
  de            ops.estado_contrato,
  para          ops.estado_contrato NOT NULL,
  guarda        text NOT NULL,
  motivo        ops.texto_sem_pii,
  ator_ref      ops.ref_opaca,                  -- quem acionou (opaco)
  ator_tipo     text NOT NULL DEFAULT 'SERVICO'
                  CHECK (ator_tipo IN ('HUMANO','SERVICO','AGENDA','EXTERNO')),
  origem        text NOT NULL,                  -- serviço/agente emissor
  evidencia     jsonb NOT NULL DEFAULT '[]',    -- refs de leitura, evidência EUDR, tx
  -- SMC-001: a saída do congelamento deixa de ser uma string. A transição
  -- aponta para a divergência efetivamente reconciliada, e a FK é o que
  -- impede forjar a reconciliação escrevendo o nome da guarda.
  divergencia_id uuid,
  evento_id     uuid,                           -- correlação com ops.evento
  ocorrido_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_transicao_contrato ON ops.contrato_transicao (contrato_id, ocorrido_em DESC);

-- Guarda estrutural: transição inválida é rejeitada na base, não só na UI.
CREATE OR REPLACE FUNCTION ops.fn_valida_transicao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.de IS NULL THEN
    IF NEW.para <> 'RASCUNHO' THEN
      RAISE EXCEPTION 'transicao inicial invalida: % (esperado RASCUNHO)', NEW.para;
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ops.transicao_permitida t
                  WHERE t.de = NEW.de AND t.para = NEW.para) THEN
    RAISE EXCEPTION 'transicao proibida: % -> %', NEW.de, NEW.para;
  END IF;
  -- SMC-001: a guarda é a do grafo, não um rótulo escolhido pelo chamador.
  IF NOT EXISTS (SELECT 1 FROM ops.transicao_permitida t
                  WHERE t.de = NEW.de AND t.para = NEW.para AND t.guarda = NEW.guarda) THEN
    RAISE EXCEPTION 'guarda % nao corresponde a transicao % -> %', NEW.guarda, NEW.de, NEW.para;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tg_valida_transicao
  BEFORE INSERT ON ops.contrato_transicao
  FOR EACH ROW EXECUTE FUNCTION ops.fn_valida_transicao();

-- P1 em forma executável: um contrato congelado não muda de estado sem que a
-- divergência seja antes reconciliada por decisão humana registrada.
CREATE OR REPLACE FUNCTION ops.fn_bloqueia_congelado() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_situacao ops.situacao_conciliacao;
  v_div      record;
  v_abertas  integer;
BEGIN
  SELECT situacao_conciliacao INTO v_situacao FROM ops.contrato WHERE id = NEW.contrato_id;
  IF v_situacao <> 'CONGELADO' THEN
    RETURN NEW;
  END IF;

  -- SMC-001. Antes, bastava escrever 'divergencia_reconciliada' na coluna de
  -- guarda para destrancar o congelamento — sem divergência reconciliada, sem
  -- operador humano e sem ator. O red team reproduziu o ataque em G1. Agora a
  -- saída exige prova, e a prova é uma linha de ops.divergencia.
  IF NEW.guarda <> 'divergencia_reconciliada' THEN
    RAISE EXCEPTION 'contrato congelado por divergencia de conciliacao (P1): % -> % bloqueada',
      NEW.de, NEW.para;
  END IF;

  IF NEW.divergencia_id IS NULL THEN
    RAISE EXCEPTION 'saida de congelamento exige divergencia_id (P1)';
  END IF;

  SELECT * INTO v_div FROM ops.divergencia WHERE id = NEW.divergencia_id;
  IF v_div IS NULL THEN
    RAISE EXCEPTION 'divergencia % inexistente (P1)', NEW.divergencia_id;
  END IF;
  IF v_div.contrato_id IS DISTINCT FROM NEW.contrato_id THEN
    RAISE EXCEPTION 'divergencia % pertence a outro contrato (P1)', NEW.divergencia_id;
  END IF;
  IF v_div.estado NOT IN ('RECONCILIADA','FALSO_POSITIVO') THEN
    RAISE EXCEPTION 'divergencia % ainda em % (P1)', NEW.divergencia_id, v_div.estado;
  END IF;
  IF v_div.reconciliada_por IS NULL THEN
    RAISE EXCEPTION 'divergencia % sem operador humano identificado (P1, P5)', NEW.divergencia_id;
  END IF;
  IF NEW.ator_tipo <> 'HUMANO' OR NEW.ator_ref IS NULL THEN
    RAISE EXCEPTION 'saida de congelamento exige ator humano identificado (P1, P5)';
  END IF;

  -- Reconciliar uma divergência não destranca o contrato se ainda houver outra
  -- aberta: o congelamento acompanha o contrato, não o incidente.
  SELECT count(*) INTO v_abertas
    FROM ops.divergencia d
   WHERE d.contrato_id = NEW.contrato_id
     AND d.estado IN ('ABERTA','EM_RECONCILIACAO');
  IF v_abertas > 0 THEN
    RAISE EXCEPTION 'contrato tem % divergencia(s) ainda aberta(s) (P1)', v_abertas;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER tg_bloqueia_congelado
  BEFORE INSERT ON ops.contrato_transicao
  FOR EACH ROW EXECUTE FUNCTION ops.fn_bloqueia_congelado();
