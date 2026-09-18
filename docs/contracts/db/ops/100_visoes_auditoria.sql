-- cpr_ops :: visões de auditoria
-- "O que se sabia, quando se soube e com base em quê" (P5) precisa ser uma
-- consulta, não uma investigação.

CREATE VIEW ops.vw_conhecimento_contrato AS
  SELECT c.id AS contrato_id, t.ocorrido_em AS quando, 'TRANSICAO' AS categoria,
         t.de || ' -> ' || t.para AS fato, t.origem, t.evidencia
    FROM ops.contrato c JOIN ops.contrato_transicao t ON t.contrato_id = c.id
  UNION ALL
  SELECT m.contrato_id, m.calculada_em, 'MARCACAO_MERCADO',
         'MTM=' || m.valor_mtm::text || ' LTV=' || m.ltv_pct::text,
         'services/oracle', jsonb_build_array(jsonb_build_object('leitura_id', m.leitura_id))
    FROM ops.marcacao_mercado m
  UNION ALL
  SELECT d.contrato_id, d.detectada_em, 'DIVERGENCIA',
         d.tipo::text || ' (' || d.severidade::text || ')', 'services/core',
         jsonb_build_object('registro', d.valor_registro, 'onchain', d.valor_onchain)
    FROM ops.divergencia d WHERE d.contrato_id IS NOT NULL
  UNION ALL
  SELECT ct.contrato_id, e.gerada_em, 'EVIDENCIA_EUDR',
         e.resultado::text, 'services/eudr',
         jsonb_build_object('hash_evidencia', encode(e.hash_evidencia,'hex'), 'bases', e.bases)
    FROM ops.evidencia_eudr e JOIN ops.contrato_talhao ct ON ct.talhao_id = e.talhao_id;

COMMENT ON VIEW ops.vw_conhecimento_contrato IS
  'Linha do tempo única de um contrato. Sustenta o painel de auditoria de W6, '
  'que deve responder em menos de três cliques.';

-- Placar da conciliação: a métrica que resolve a lacuna informacional nº 1.
CREATE VIEW ops.vw_placar_conciliacao AS
  SELECT i.tipo,
         count(*)                                   AS injetadas,
         count(i.detectada_divergencia_id)          AS detectadas,
         percentile_disc(0.5) WITHIN GROUP (ORDER BY i.latencia_ms) AS latencia_p50_ms,
         max(i.latencia_ms)                         AS latencia_max_ms,
         p.sla_deteccao,
         count(*) FILTER (
           WHERE i.latencia_ms IS NOT NULL
             AND i.latencia_ms <= EXTRACT(epoch FROM p.sla_deteccao) * 1000
         )                                          AS dentro_do_sla
    FROM sim.injecao i
    JOIN ops.politica_divergencia p ON p.tipo = i.tipo
   GROUP BY i.tipo, p.sla_deteccao;

-- Contratos com efeito contratual suspenso por falta de dado confiável.
CREATE VIEW ops.vw_contratos_sem_dado_confiavel AS
  SELECT c.id AS contrato_id, l.tipo_leitura, l.estado, l.expira_em
    FROM ops.contrato c
    JOIN ops.uso_leitura u ON u.decisao_id = c.id
    JOIN ops.leitura_oraculo l ON l.id = u.leitura_id
   WHERE l.estado IN ('EM_DISPUTA','SEM_QUORUM') OR l.expira_em < now();
