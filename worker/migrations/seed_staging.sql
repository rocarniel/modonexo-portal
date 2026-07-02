-- Dados de teste para o ambiente de staging (não usar em produção)

INSERT INTO parceiros (id, nome_completo, email, status, creci, whatsapp)
VALUES ('recxaji0y6dpbhsah', 'João Teste Pendente', 'joao.teste.staging@example.com', 'Pendente', 'CRECI-SP 11111 (PF)', '11999990001');

INSERT INTO parceiros (id, nome_completo, email, status, creci, whatsapp)
VALUES ('recxthv3a3zmf8mdd', 'Maria Teste Ativa', 'maria.teste.staging@example.com', 'Ativo', 'CRECI-SC 22222 (PF)', '47999990002');

INSERT INTO oportunidades (
  id, titulo, tipo_imovel, tipo_negocio, municipio, estado,
  area_total_m2, valor_pretendido, status, origem,
  token_compartilhamento, email_solicitante, parceiro_id
) VALUES (
  'rec4v30t9nt3w5uzb', 'Casa residencial · Campinas · SP', 'Casa residencial', 'Venda', 'Campinas', 'São Paulo',
  250, 850000, 'Recebido', 'Parceiro',
  'tokenteste01aabbcc', 'maria.teste.staging@example.com', 'recxthv3a3zmf8mdd'
);

INSERT INTO oportunidades (
  id, titulo, tipo_imovel, tipo_negocio, municipio, estado,
  area_total_m2, valor_pretendido, status, origem,
  token_compartilhamento, email_solicitante, parceiro_id
) VALUES (
  'recikcidkwnnhj7xv', 'Terreno/Lote urbano · Balneário Camboriú · SC', 'Terreno/Lote urbano', 'Venda', 'Balneário Camboriú', 'Santa Catarina',
  500, 1200000, 'Em análise', 'Parceiro',
  'tokenteste02aabbcc', 'maria.teste.staging@example.com', 'recxthv3a3zmf8mdd'
);

INSERT INTO oportunidades (
  id, titulo, tipo_imovel, tipo_negocio, municipio, estado,
  area_total_m2, valor_pretendido, status, origem,
  token_compartilhamento, email_solicitante, parceiro_id
) VALUES (
  'recg0fn9xuy41iblj', 'Apartamento · Balneário Camboriú · SC', 'Apartamento', 'Locação', 'Balneário Camboriú', 'Santa Catarina',
  90, 450000, 'Viável', 'MODO',
  'tokenteste03aabbcc', 'rocarniel@gmail.com', NULL
);

INSERT INTO oportunidade_finalidades (oportunidade_id, finalidade, ordem)
VALUES ('rec4v30t9nt3w5uzb', 'Venda', 0);

INSERT INTO demandas (id, titulo, tipo_imovel, localizacao_desejada, valor_maximo, visivel_parceiros)
VALUES ('rech75lxo6qjiujv6', 'Procuro terreno em BC', 'Terreno/Lote urbano', 'Balneário Camboriú', 1500000, 1);
