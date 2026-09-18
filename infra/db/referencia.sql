-- Dados de referência: configuração, não massa de teste.
-- Idempotente — roda a cada subida do ambiente.

-- Fontes de oráculo. 'independente_de' é o que impede que dois agregadores do
-- mesmo boletim contem como duas fontes no quórum (P4, ADR-0003).
INSERT INTO ops.fonte_oraculo (codigo, tipo_leitura, descricao, operador, peso, independente_de) VALUES
  ('CEPEA',      'PRECO',       'Indicador do café arábica',              'CEPEA/ESALQ', 1.0, '{}'),
  ('B3_FUT',     'PRECO',       'Ajuste do futuro de café',               'B3',          1.0, '{}'),
  ('COOP_SUL',   'PRECO',       'Preço de cooperativa do Sul de Minas',   'Cooperativa', 0.8, '{}'),
  ('AGREGADOR_X','PRECO',       'Agregador que republica o CEPEA',        'Terceiro',    0.5, '{CEPEA}'),
  ('PRODES',     'GEOESPACIAL', 'Desmatamento por corte raso',            'INPE',        1.0, '{}'),
  ('MAPBIOMAS',  'GEOESPACIAL', 'Alertas de desmatamento',                'MapBiomas',   1.0, '{}'),
  ('BANCO_A',    'PAGAMENTO',   'Confirmação de crédito em conta',        'Banco',       1.0, '{}'),
  ('SPI',        'PAGAMENTO',   'Confirmação de liquidação instantânea',  'Arranjo',     1.0, '{}'),
  ('REG_SIM_1',  'REGISTRO',    'Consulta primária à registradora',       'Registradora',1.0, '{}'),
  ('REG_SIM_2',  'REGISTRO',    'Consulta de conferência à registradora', 'Registradora',1.0, '{}'),
  ('SEFAZ',      'FISCAL',      'Situação fiscal do emitente',            'SEFAZ',       1.0, '{}'),
  ('RFB',        'FISCAL',      'Situação cadastral',                     'RFB',         1.0, '{}'),
  ('INMET',      'CLIMATICO',   'Estação meteorológica',                  'INMET',       1.0, '{}')
ON CONFLICT (codigo) DO NOTHING;

-- Bases de referência do EUDR. A data de corte é 31/12/2020 e é coluna, não
-- constante: a aplicação do regulamento já foi adiada mais de uma vez.
-- resolucao_m: ordem de grandeza compatível com sensoriamento óptico de média
-- resolução usado por essas bases. O valor exato de cada produto precisa ser
-- confirmado na documentação da fonte antes do piloto. [#REF]
INSERT INTO ops.base_referencia_geo (codigo, versao, data_corte, cobertura, publicada_em, resolucao_m, hash_dataset) VALUES
  ('PRODES',    '2025.1', DATE '2020-12-31', 'Brasil', DATE '2025-11-30', 30, digest('prodes-2025.1','sha256')),
  ('MAPBIOMAS', '9.0',    DATE '2020-12-31', 'Brasil', DATE '2025-08-15', 30, digest('mapbiomas-9.0','sha256'))
ON CONFLICT (codigo, versao) DO NOTHING;

-- Política de waterfall. Os números são hipótese de engenharia, calibrável por
-- E4 — e é por isso que são linha de tabela e não constante de código.
INSERT INTO ops.waterfall_politica (id, rotulo, versao)
VALUES ('00000000-0000-4000-8000-00000000f001', 'cafe-sul-de-minas', 1)
ON CONFLICT (rotulo, versao) DO NOTHING;

INSERT INTO ops.waterfall_nivel (politica_id, nivel, rotulo, descricao, gatilho, cap_pct_exposicao, prazo_recuperacao_dias, haircut_pct) VALUES
  ('00000000-0000-4000-8000-00000000f001', 1, 'Penhor da safra',
   'Produto penhorado, com averbação. Recupera rápido quando há safra no armazém.',
   'inadimplencia_confirmada',  60.0000,  45, 25.0000),
  ('00000000-0000-4000-8000-00000000f001', 2, 'Seguro agrícola',
   'Cobre quebra de produtividade, não queda de preço. É esta a distinção que separa safra ruim de mercado ruim.',
   'quebra_produtividade',      25.0000,  90, 10.0000),
  ('00000000-0000-4000-8000-00000000f001', 3, 'Aval ou fiança',
   'Depende do patrimônio do avalista, que em quebra sistêmica está comprometido junto.',
   'excussao_frustrada_nivel_1', 20.0000, 180, 40.0000),
  ('00000000-0000-4000-8000-00000000f001', 4, 'Fundo mutualizado',
   'Absorve perda residual do conjunto. Em evento sistêmico é chamado por todos ao mesmo tempo — é o nível que E4 cobra.',
   'perda_residual',            15.0000,  30, 0.0000),
  ('00000000-0000-4000-8000-00000000f001', 5, 'Garantia real imobiliária',
   'Maior valor e maior prazo. Recuperação judicial de imóvel rural não é evento de meses.',
   'perda_residual_apos_fundo', 100.0000, 540, 35.0000)
ON CONFLICT (politica_id, nivel) DO NOTHING;
