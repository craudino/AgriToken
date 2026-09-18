-- Testes de conformidade da trilha cpr_audit (P5, P6).
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

INSERT INTO audit.registro (id, tipo, sujeito_tipo, sujeito_id, origem, ocorrido_em, payload)
VALUES (gen_random_uuid(),'contrato.registrado','CONTRATO','ct-1','services/core@0.1.0', now(), '{"valor_face":750000}'),
       (gen_random_uuid(),'contrato.espelhado','CONTRATO','ct-1','services/core@0.1.0', now(), '{"token_id":1}'),
       (gen_random_uuid(),'conciliacao.divergencia','CONTRATO','ct-1','services/core@0.1.0', now(), '{"tipo":"VALOR_FACE_ALTERADO"}');

DO $$
DECLARE v_falhas int;
BEGIN
  SELECT count(*) INTO v_falhas FROM audit.verifica_cadeia() WHERE NOT ok;
  IF v_falhas > 0 THEN RAISE EXCEPTION 'FALHOU: cadeia de auditoria inconsistente (% registros)', v_falhas; END IF;
  RAISE NOTICE 'OK  P5: cadeia de hash íntegra em 3 registros';
END
$$;

SELECT pg_temp.deve_falhar($$UPDATE audit.registro SET payload = '{}' WHERE seq = 1$$,
                           'P5: UPDATE na trilha de auditoria');
SELECT pg_temp.deve_falhar($$DELETE FROM audit.registro WHERE seq = 1$$,
                           'P5: DELETE na trilha de auditoria');
SELECT pg_temp.deve_falhar($$TRUNCATE audit.registro$$,
                           'P5: TRUNCATE na trilha de auditoria');
SELECT pg_temp.deve_falhar($$
  INSERT INTO audit.registro (id, tipo, sujeito_tipo, sujeito_id, origem, ocorrido_em, payload)
  VALUES (gen_random_uuid(),'kyc.aprovado','PRODUTOR','pr-1','services/compliance', now(),
          '{"documento":"123.456.789-09"}')
$$, 'P2: CPF no payload da trilha de auditoria');

-- P6: canonicalização é determinística — ordem das chaves não altera o hash.
DO $$
DECLARE a text; b text;
BEGIN
  a := jsonb_canonical('{"b":1,"a":{"d":4,"c":[3,2]}}'::jsonb);
  b := jsonb_canonical('{"a":{"c":[3,2],"d":4},"b":1}'::jsonb);
  IF a <> b THEN RAISE EXCEPTION 'FALHOU: canonicalização não determinística (% vs %)', a, b; END IF;
  RAISE NOTICE 'OK  P6: canonicalização determinística -> %', a;
END
$$;

ROLLBACK;
