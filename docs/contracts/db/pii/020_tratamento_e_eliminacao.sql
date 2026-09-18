-- cpr_pii :: registro de operações de tratamento e direito de eliminação (LGPD)

CREATE TABLE pii.base_legal (
  codigo      text PRIMARY KEY,          -- CONSENTIMENTO | CONTRATO | OBRIGACAO_LEGAL | LEGITIMO_INTERESSE
  descricao   text NOT NULL,
  fundamento  text NOT NULL              -- dispositivo invocado
);

INSERT INTO pii.base_legal (codigo, descricao, fundamento) VALUES
  ('CONTRATO',        'Execução de contrato ou procedimentos preliminares', 'LGPD art. 7º, V'),
  ('OBRIGACAO_LEGAL', 'Cumprimento de obrigação legal ou regulatória',      'LGPD art. 7º, II'),
  ('CONSENTIMENTO',   'Consentimento livre, informado e inequívoco',        'LGPD art. 7º, I'),
  ('LEGITIMO_INTERESSE','Interesse legítimo, com teste de balanceamento',   'LGPD art. 7º, IX');

CREATE TABLE pii.operacao_tratamento (
  id             bigserial PRIMARY KEY,
  titular_id     uuid NOT NULL REFERENCES pii.titular(id),
  finalidade     text NOT NULL,
  base_legal     text NOT NULL REFERENCES pii.base_legal(codigo),
  campos         text[] NOT NULL,
  operacao       text NOT NULL CHECK (operacao IN ('COLETA','ACESSO','USO','COMPARTILHAMENTO','ELIMINACAO')),
  destinatario   text,                    -- para compartilhamento
  solicitante    text NOT NULL,           -- serviço ou operador
  justificativa  text NOT NULL,
  ocorrido_em    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compartilhamento_tem_destinatario
    CHECK (operacao <> 'COMPARTILHAMENTO' OR destinatario IS NOT NULL)
);
CREATE INDEX ix_tratamento_titular ON pii.operacao_tratamento (titular_id, ocorrido_em DESC);
COMMENT ON TABLE pii.operacao_tratamento IS
  'Todo acesso a texto claro passa por aqui. Se o registro de acesso for '
  'opcional, ele não existe quando o regulador pergunta.';

CREATE TABLE pii.pedido_eliminacao (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titular_id      uuid NOT NULL REFERENCES pii.titular(id),
  solicitado_em   timestamptz NOT NULL DEFAULT now(),
  canal           text NOT NULL,
  estado          text NOT NULL DEFAULT 'RECEBIDO'
                   CHECK (estado IN ('RECEBIDO','EM_ANALISE','PARCIAL','CONCLUIDO','RECUSADO')),
  retencao_obrigatoria jsonb NOT NULL DEFAULT '[]',   -- o que a lei obriga a manter, e por quê
  chave_destruida_em timestamptz,
  comprovante_kms text,
  verificacao_irreversibilidade jsonb,   -- resultado do teste: decifrar falhou
  concluido_em    timestamptz,
  CONSTRAINT concluido_destroi_chave
    CHECK (estado <> 'CONCLUIDO' OR (chave_destruida_em IS NOT NULL AND comprovante_kms IS NOT NULL))
);
COMMENT ON COLUMN pii.pedido_eliminacao.retencao_obrigatoria IS
  'A eliminação não é total: registros exigidos por obrigação legal '
  'permanecem, pseudonimizados. O pedido documenta o que ficou e sob que '
  'fundamento — é isso que sustenta a resposta ao titular e ao regulador.';
