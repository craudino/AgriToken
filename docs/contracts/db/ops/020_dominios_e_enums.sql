-- cpr_ops :: domínios e enumerações
-- Toda enumeração aqui é contrato congelado da Fase 0: acrescentar valor é
-- mudança de contrato; remover ou renomear é mudança quebrante.

-- ---------------------------------------------------------------------------
-- Domínios de proteção (P2). O CHECK é o controle preventivo: uma inserção
-- com padrão de CPF, CNPJ ou e-mail falha na base, não no code review.
-- ---------------------------------------------------------------------------
CREATE DOMAIN ops.texto_sem_pii AS text
  CONSTRAINT sem_cpf   CHECK (VALUE !~ '(^|[^0-9])[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}([^0-9]|$)')
  CONSTRAINT sem_cnpj  CHECK (VALUE !~ '(^|[^0-9])[0-9]{2}\.?[0-9]{3}\.?[0-9]{3}/?[0-9]{4}-?[0-9]{2}([^0-9]|$)')
  CONSTRAINT sem_email CHECK (VALUE !~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}');
COMMENT ON DOMAIN ops.texto_sem_pii IS
  'Texto livre em base sem PII. Rejeita padrões de CPF, CNPJ e e-mail (P2).';

CREATE DOMAIN ops.hash32 AS bytea
  CONSTRAINT tamanho CHECK (octet_length(VALUE) = 32);
COMMENT ON DOMAIN ops.hash32 IS 'keccak256/sha256 em 32 bytes; nunca texto hexadecimal solto.';

CREATE DOMAIN ops.ref_opaca AS bytea
  CONSTRAINT tamanho CHECK (octet_length(VALUE) = 16);
COMMENT ON DOMAIN ops.ref_opaca IS
  'Pseudônimo ALEATÓRIO de 128 bits. Jamais derivado de PII: derivar de CPF '
  'permitiria reidentificação por dicionário (10^11 candidatos). Ver ADR-0002.';

CREATE DOMAIN ops.valor_brl AS numeric(18,2)
  CONSTRAINT nao_negativo CHECK (VALUE >= 0);

CREATE DOMAIN ops.sacas AS numeric(14,4)      -- saca de 60 kg, café
  CONSTRAINT positivo CHECK (VALUE > 0);

CREATE DOMAIN ops.pct AS numeric(7,4)
  CONSTRAINT faixa CHECK (VALUE >= 0 AND VALUE <= 100);

-- ---------------------------------------------------------------------------
-- Ciclo de vida do contrato espelhado (Briefing 6.1)
-- ---------------------------------------------------------------------------
CREATE TYPE ops.estado_contrato AS ENUM (
  'RASCUNHO', 'EM_VERIFICACAO', 'REGISTRADO', 'ESPELHADO', 'ATIVO',
  'EM_DISPUTA', 'INADIMPLENTE', 'LIQUIDADO', 'EXECUTADO'
);

CREATE TYPE ops.situacao_conciliacao AS ENUM (
  'NAO_APLICAVEL',   -- ainda não espelhado
  'PENDENTE',        -- espelhado, primeira conciliação não concluída
  'CONCILIADO',
  'DIVERGENTE',      -- divergência aberta, severidade < CRITICA
  'CONGELADO'        -- divergência crítica: operações suspensas (P1)
);

-- ---------------------------------------------------------------------------
-- Catálogo de divergências registro <-> token (lacuna informacional nº 1).
-- O aceite de W2 exige dez tipos injetáveis e detectados; o catálogo tem doze.
-- ---------------------------------------------------------------------------
CREATE TYPE ops.tipo_divergencia AS ENUM (
  'TITULO_BAIXADO_NO_REGISTRO',      -- 1  registro liquidou; token segue ativo
  'CESSAO_NAO_REFLETIDA',            -- 2  titularidade mudou no registro
  'VALOR_FACE_ALTERADO',             -- 3
  'QUANTIDADE_ALTERADA',             -- 4
  'VENCIMENTO_ALTERADO',             -- 5
  'GARANTIA_ALTERADA',               -- 6  garantia incluída/excluída no registro
  'ONUS_OU_GRAVAME_NAO_REFLETIDO',   -- 7  penhora, arresto, bloqueio judicial
  'TITULO_INEXISTENTE_NO_REGISTRO',  -- 8  token órfão
  'TOKEN_AUSENTE_PARA_REGISTRO',     -- 9  registro sem espelho correspondente
  'DUPLICIDADE_DE_ANCORA',           -- 10 dois tokens ativos para um registro (viola P3)
  'ESTADO_DIVERGENTE',               -- 11 ciclo de vida incompatível
  'HASH_DOCUMENTAL_DIVERGENTE',      -- 12 conteúdo do título mudou sem novo espelho
  -- SMC-004: o catálogo original só enxergava o sentido registro -> token.
  -- E1 apontou em G1 que a fração pode circular on-chain sem cessão registrada
  -- e a conciliação seria cega a isso. Estes dois fecham o sentido inverso.
  'TRANSFERENCIA_SEM_CESSAO',        -- 13 titular on-chain mudou sem cessão no registro
  'FRACIONAMENTO_NAO_REFLETIDO'      -- 14 frações emitidas on-chain sem lastro registrado
);

CREATE TYPE ops.severidade AS ENUM ('INFORMATIVA','BAIXA','MEDIA','ALTA','CRITICA');

CREATE TYPE ops.estado_divergencia AS ENUM (
  'ABERTA', 'EM_RECONCILIACAO', 'RECONCILIADA', 'FALSO_POSITIVO'
);

-- ---------------------------------------------------------------------------
-- Garantias e waterfall
-- ---------------------------------------------------------------------------
CREATE TYPE ops.tipo_garantia AS ENUM (
  'PENHOR_SAFRA', 'ALIENACAO_FIDUCIARIA_IMOVEL', 'ALIENACAO_FIDUCIARIA_MAQUINA',
  'HIPOTECA', 'AVAL', 'FIANCA', 'SEGURO_AGRICOLA', 'CESSAO_RECEBIVEL',
  'FUNDO_MUTUALIZADO', 'CAUCAO_TOKEN'
);

CREATE TYPE ops.estado_excussao AS ENUM (
  'NAO_ACIONADA', 'NOTIFICADA', 'EM_EXCUSSAO', 'EXCUTIDA', 'FRUSTRADA'
);

-- ---------------------------------------------------------------------------
-- Oráculos
-- ---------------------------------------------------------------------------
CREATE TYPE ops.tipo_leitura AS ENUM (
  'PRECO', 'GEOESPACIAL', 'FISCAL', 'CLIMATICO', 'PAGAMENTO', 'REGISTRO'
);

CREATE TYPE ops.estado_leitura AS ENUM (
  'COLETANDO',       -- sem quórum ainda; sem efeito contratual
  'EFETIVA',         -- quórum atingido, dentro da política
  'DEGRADADA',       -- quórum mínimo atingido com sinalização (fonte caída)
  'SEM_QUORUM',      -- não produz decisão contratual (P4)
  'EM_DISPUTA',      -- efeito contratual suspenso
  'INVALIDADA'
);

CREATE TYPE ops.criticidade_leitura AS ENUM ('INFORMATIVA', 'CONTRATUAL');
COMMENT ON TYPE ops.criticidade_leitura IS
  'CONTRATUAL exige quórum >= 2 fontes por P4. INFORMATIVA não pode, por '
  'construção, ser insumo de decisão contratual.';

-- ---------------------------------------------------------------------------
-- EUDR
-- ---------------------------------------------------------------------------
CREATE TYPE ops.resultado_eudr AS ENUM (
  'CONFORME', 'NAO_CONFORME', 'LIMITROFE', 'INCONCLUSIVO'
);

CREATE TYPE ops.estado_dds AS ENUM (
  'RASCUNHO', 'EMITIDA', 'SUBSTITUIDA', 'REVOGADA'
);

-- ---------------------------------------------------------------------------
-- Diversos
-- ---------------------------------------------------------------------------
CREATE TYPE ops.porte_produtor AS ENUM ('PEQUENO', 'MEDIO', 'GRANDE');

CREATE TYPE ops.situacao_kyc AS ENUM (
  'NAO_INICIADO', 'EM_ANALISE', 'APROVADO', 'REPROVADO', 'EXPIRADO', 'ELIMINADO'
);

CREATE TYPE ops.commodity AS ENUM ('CAFE_ARABICA', 'CAFE_CONILON');
