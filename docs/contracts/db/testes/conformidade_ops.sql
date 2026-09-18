-- Testes de conformidade do esquema cpr_ops.
-- Cada bloco prova que um princípio do Briefing (Seção 2) é executável, e não
-- apenas declarado. Executado em CI por infra/ci/validar-esquema.sh.
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.deve_falhar(p_sql text, p_caso text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'OK  % (rejeitado: %)', p_caso, left(SQLERRM, 70);
    RETURN;
  END;
  RAISE EXCEPTION 'FALHOU: % foi aceito e deveria ter sido rejeitado', p_caso;
END
$$;

-- Massa mínima -------------------------------------------------------------
INSERT INTO ops.produtor (id, ref_opaca, pii_ref, tipo_pessoa, porte, uf, municipio_ibge)
VALUES ('11111111-1111-1111-1111-111111111111', decode(repeat('a1',16),'hex'),
        '22222222-2222-2222-2222-222222222222', 'PF', 'PEQUENO', 'MG', '3145901');

INSERT INTO ops.contrato (id, registro_id, registro_entidade, registro_hash_ancora,
                          produtor_id, commodity, quantidade_sacas, safra, vencimento, valor_face)
VALUES ('33333333-3333-3333-3333-333333333333', 'CPR-0001', 'REG-SIM',
        digest('REG-SIM|CPR-0001','sha256')::ops.hash32,
        '11111111-1111-1111-1111-111111111111', 'CAFE_ARABICA', 500, '2026/2027',
        DATE '2027-07-31', 750000.00);

-- P2 — dado pessoal não entra na base operacional ---------------------------
SELECT pg_temp.deve_falhar($$
  UPDATE ops.contrato SET congelado_motivo = 'titular CPF 123.456.789-09 contestou'
   WHERE id = '33333333-3333-3333-3333-333333333333'
$$, 'P2: CPF em campo textual de cpr_ops');

SELECT pg_temp.deve_falhar($$
  INSERT INTO ops.incidente (origem, severidade, titulo, descricao)
  VALUES ('CONCILIACAO','ALTA','contato','falar com produtor@fazenda.com.br')
$$, 'P2: e-mail em campo textual de cpr_ops');

-- P3 — unicidade do colateral ----------------------------------------------
SELECT pg_temp.deve_falhar($$
  INSERT INTO ops.contrato (registro_id, registro_entidade, registro_hash_ancora,
                            produtor_id, commodity, quantidade_sacas, safra, vencimento, valor_face)
  VALUES ('CPR-0002', 'REG-SIM', digest('REG-SIM|CPR-0001','sha256')::ops.hash32,
          '11111111-1111-1111-1111-111111111111','CAFE_ARABICA', 100, '2026/2027',
          DATE '2027-07-31', 150000.00)
$$, 'P3: segunda âncora para o mesmo registro');

-- Máquina de estados: transição proibida é rejeitada no domínio -------------
INSERT INTO ops.contrato_transicao (contrato_id, de, para, guarda, origem)
VALUES ('33333333-3333-3333-3333-333333333333', NULL, 'RASCUNHO', 'criacao', 'services/core');

SELECT pg_temp.deve_falhar($$
  INSERT INTO ops.contrato_transicao (contrato_id, de, para, guarda, origem)
  VALUES ('33333333-3333-3333-3333-333333333333','RASCUNHO','LIQUIDADO','atalho','services/core')
$$, 'Máquina de estados: RASCUNHO -> LIQUIDADO');

-- P1 — contrato congelado não transita sem reconciliação humana -------------
UPDATE ops.contrato
   SET estado = 'ATIVO', situacao_conciliacao = 'CONGELADO',
       congelado_em = now(), congelado_motivo = 'divergencia critica injetada',
       token_chain_id = 1337, token_contrato_addr = decode(repeat('bb',20),'hex'),
       token_id = 1, token_slot = 1, espelhado_em = now()
 WHERE id = '33333333-3333-3333-3333-333333333333';

SELECT pg_temp.deve_falhar($$
  INSERT INTO ops.contrato_transicao (contrato_id, de, para, guarda, origem)
  VALUES ('33333333-3333-3333-3333-333333333333','ATIVO','LIQUIDADO',
          'pagamento_conciliado_e_baixa_no_registro','services/core')
$$, 'P1: transição em contrato congelado');

-- P1 — divergência crítica sem congelamento é estado impossível -------------
INSERT INTO ops.conciliacao_execucao (id, escopo)
VALUES ('44444444-4444-4444-4444-444444444444','COMPLETA');

SELECT pg_temp.deve_falhar($$
  INSERT INTO ops.divergencia (execucao_id, contrato_id, tipo, severidade, congelou_contrato)
  VALUES ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
          'TITULO_BAIXADO_NO_REGISTRO','CRITICA', false)
$$, 'P1: divergência crítica sem congelar o contrato');

-- P4 — sem quórum não há decisão contratual --------------------------------
SELECT pg_temp.deve_falhar($$
  UPDATE ops.politica_quorum SET min_fontes = 1, min_fontes_independentes = 1
   WHERE tipo_leitura = 'PRECO'
$$, 'P4: configurar leitura contratual com fonte única');

INSERT INTO ops.leitura_oraculo (id, tipo_leitura, chave, valor_numerico, unidade,
                                 referencia_em, expira_em, estado, politica_snapshot, hash_linhagem)
VALUES ('55555555-5555-5555-5555-555555555555','PRECO','CAFE_ARABICA/BRL-SACA', 1480.00,'BRL/saca',
        now(), now() + interval '36 hours','SEM_QUORUM','{}'::jsonb, digest('x','sha256')::ops.hash32);

SELECT pg_temp.deve_falhar($$
  INSERT INTO ops.uso_leitura (leitura_id, decisao_tipo, decisao_id)
  VALUES ('55555555-5555-5555-5555-555555555555','MTM','33333333-3333-3333-3333-333333333333')
$$, 'P4: decisão contratual sobre leitura sem quórum');

INSERT INTO ops.leitura_oraculo (id, tipo_leitura, chave, valor_json, referencia_em, expira_em,
                                 estado, fontes_usadas, fontes_independentes, politica_snapshot, hash_linhagem)
VALUES ('66666666-6666-6666-6666-666666666666','CLIMATICO','ESTACAO/MG-123','{"mm":12}'::jsonb,
        now(), now() + interval '24 hours','EFETIVA', 1, 1, '{}'::jsonb, digest('y','sha256')::ops.hash32);

SELECT pg_temp.deve_falhar($$
  INSERT INTO ops.uso_leitura (leitura_id, decisao_tipo, decisao_id)
  VALUES ('66666666-6666-6666-6666-666666666666','GATILHO_INADIMPLENCIA','33333333-3333-3333-3333-333333333333')
$$, 'P4: leitura informativa sustentando decisão contratual');

-- P5 — evento é imutável ----------------------------------------------------
INSERT INTO ops.evento (id, tipo, sujeito_tipo, sujeito_id, correlacao_id, origem, ocorrido_em, payload, payload_hash)
VALUES ('77777777-7777-7777-7777-777777777777','contrato.espelhado','CONTRATO',
        '33333333-3333-3333-3333-333333333333','88888888-8888-8888-8888-888888888888',
        'services/core', now(), '{"token_id":1}'::jsonb, digest('z','sha256')::ops.hash32);

SELECT pg_temp.deve_falhar($$
  UPDATE ops.evento SET payload = '{"token_id":2}'::jsonb
   WHERE id = '77777777-7777-7777-7777-777777777777'
$$, 'P5: alteração de evento já registrado');

DELETE FROM ops.evento WHERE id = '77777777-7777-7777-7777-777777777777';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ops.evento WHERE id = '77777777-7777-7777-7777-777777777777') THEN
    RAISE EXCEPTION 'FALHOU: P5 — DELETE em ops.evento surtiu efeito';
  END IF;
  RAISE NOTICE 'OK  P5: DELETE em ops.evento é inócuo';
END
$$;

-- Garantia: o mesmo talhão não lastreia dois penhores vivos (P3) ------------
INSERT INTO ops.talhao (id, produtor_id, car_ref, car_hash, area_declarada_ha, commodity)
VALUES ('99999999-9999-9999-9999-999999999999','11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', digest('car','sha256')::ops.hash32, 12.5,'CAFE_ARABICA');

INSERT INTO ops.garantia (contrato_id, tipo, nivel_waterfall, valor_declarado, talhao_id)
VALUES ('33333333-3333-3333-3333-333333333333','PENHOR_SAFRA',1, 400000.00,
        '99999999-9999-9999-9999-999999999999');

SELECT pg_temp.deve_falhar($$
  INSERT INTO ops.garantia (contrato_id, tipo, nivel_waterfall, valor_declarado, talhao_id)
  VALUES ('33333333-3333-3333-3333-333333333333','PENHOR_SAFRA',1, 100000.00,
          '99999999-9999-9999-9999-999999999999')
$$, 'P3: segundo penhor sobre o mesmo talhão');

ROLLBACK;
