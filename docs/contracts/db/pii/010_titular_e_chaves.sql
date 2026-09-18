-- cpr_pii :: titular, chaves e crypto-shredding
-- Modelo: todo campo identificante é cifrado com a chave do titular; a chave
-- vive em KMS/HSM e aqui existe apenas sua referência. Eliminar o titular é
-- destruir a chave — o texto cifrado remanescente vira ruído (crypto-shredding).

CREATE TABLE pii.chave_titular (
  titular_id     uuid PRIMARY KEY,
  kms_key_ref    text NOT NULL UNIQUE,     -- identificador no KMS/HSM; a chave nunca transita por aqui
  algoritmo      text NOT NULL DEFAULT 'AES-256-GCM',
  criada_em      timestamptz NOT NULL DEFAULT now(),
  destruida_em   timestamptz,
  destruicao_ref text,                     -- comprovante do KMS
  CONSTRAINT destruicao_tem_comprovante
    CHECK ((destruida_em IS NULL) = (destruicao_ref IS NULL))
);
COMMENT ON TABLE pii.chave_titular IS
  'Uma chave por titular. Chave compartilhada entre titulares tornaria a '
  'eliminação individual impossível — o erro clássico de projeto que E2 procura.';

CREATE TABLE pii.titular (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ops_produtor_id uuid NOT NULL UNIQUE,    -- ponteiro para cpr_ops.produtor; sem FK (base distinta)
  tipo_pessoa    char(2) NOT NULL CHECK (tipo_pessoa IN ('PF','PJ')),

  -- Campos identificantes: SEMPRE cifrados. Nenhuma coluna em texto claro.
  nome_cif           bytea NOT NULL,
  documento_cif      bytea NOT NULL,       -- CPF ou CNPJ
  nascimento_cif     bytea,
  contato_cif        bytea,                -- telefone, e-mail
  endereco_cif       bytea,
  dados_bancarios_cif bytea,
  car_numero_cif     bytea,

  -- Índice cego: HMAC com chave de serviço, permite buscar sem decifrar.
  documento_hmac bytea NOT NULL UNIQUE CHECK (octet_length(documento_hmac) = 32),

  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  eliminado_em   timestamptz
);
COMMENT ON COLUMN pii.titular.documento_hmac IS
  'HMAC-SHA256 com chave de serviço rotacionável, não hash simples: hash de '
  'CPF é reversível por força bruta em minutos.';

CREATE TABLE pii.credencial_verificavel (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titular_id   uuid NOT NULL REFERENCES pii.titular(id),
  tipo         text NOT NULL,           -- KycAprovado | ProdutorRural | CarValido
  did_emissor  text NOT NULL,
  did_sujeito  text NOT NULL,
  vc_cif       bytea NOT NULL,          -- a VC completa, cifrada
  vc_hash      bytea NOT NULL CHECK (octet_length(vc_hash) = 32),
  emitida_em   timestamptz NOT NULL DEFAULT now(),
  expira_em    timestamptz NOT NULL,
  revogada_em  timestamptz,
  status_list_index integer             -- StatusList2021 para revogação sem correlação
);

CREATE TABLE pii.resultado_kyc (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titular_id    uuid NOT NULL REFERENCES pii.titular(id),
  provedor      text NOT NULL,
  listas_consultadas text[] NOT NULL,    -- PEP, sancoes, embargos IBAMA, lista suja MTE
  resultado     text NOT NULL CHECK (resultado IN ('APROVADO','REPROVADO','INCONCLUSIVO')),
  motivo_cif    bytea,                   -- motivo pode conter PII: cifrado
  evidencia_uri text NOT NULL,
  evidencia_hash bytea NOT NULL CHECK (octet_length(evidencia_hash) = 32),
  executado_em  timestamptz NOT NULL DEFAULT now(),
  valido_ate    date NOT NULL
);
