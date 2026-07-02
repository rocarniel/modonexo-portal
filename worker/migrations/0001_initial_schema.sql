PRAGMA foreign_keys = ON;

CREATE TABLE parceiros (
  id TEXT PRIMARY KEY,
  nome_completo TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente','Ativo','Inativo','Suspenso')),
  creci TEXT,
  whatsapp TEXT,
  data_cadastro TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_parceiros_email ON parceiros(email);
CREATE INDEX idx_parceiros_email_lower ON parceiros(lower(email));

CREATE TABLE oportunidades (
  id TEXT PRIMARY KEY,
  titulo TEXT NOT NULL,
  tipo_imovel TEXT NOT NULL CHECK (tipo_imovel IN (
    'Casa residencial','Terreno/Lote urbano','Sala comercial','Gleba rural','Apartamento','Área para loteamento')),
  tipo_negocio TEXT CHECK (tipo_negocio IS NULL OR tipo_negocio IN (
    'Venda','Locação','Permuta','Parceria','Lançamento','Incorporação','Loteamento')),
  cep TEXT,
  endereco TEXT,
  municipio TEXT NOT NULL,
  estado TEXT NOT NULL,
  area_total_m2 REAL,
  area_privativa_m2 REAL,
  valor_pretendido REAL NOT NULL,
  comissao_pct REAL,
  detalhes_comissao TEXT,
  link_video TEXT,
  link_kmz TEXT,
  observacoes TEXT,
  latitude REAL,
  longitude REAL,
  status TEXT NOT NULL DEFAULT 'Recebido' CHECK (status IN (
    'Recebido','Em análise','Em negociação','Aguardando documentos','Viável','Condições inviáveis','Descartado')),
  motivo_status_negativo TEXT,
  origem TEXT NOT NULL DEFAULT 'Parceiro' CHECK (origem IN ('Parceiro','MODO')),
  token_compartilhamento TEXT NOT NULL,
  data_entrada TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d','now')),
  email_solicitante TEXT NOT NULL,
  arquivos_json TEXT,
  historico_json TEXT,
  parceiro_id TEXT REFERENCES parceiros(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (area_total_m2 IS NOT NULL OR area_privativa_m2 IS NOT NULL)
);
CREATE UNIQUE INDEX idx_oportunidades_token ON oportunidades(token_compartilhamento);
CREATE INDEX idx_oportunidades_email_solicitante ON oportunidades(email_solicitante);
CREATE INDEX idx_oportunidades_email_solicitante_lower ON oportunidades(lower(email_solicitante));
CREATE INDEX idx_oportunidades_parceiro_id ON oportunidades(parceiro_id);
CREATE INDEX idx_oportunidades_data_entrada ON oportunidades(data_entrada DESC);
CREATE INDEX idx_oportunidades_origem ON oportunidades(origem);

CREATE TABLE oportunidade_finalidades (
  oportunidade_id TEXT NOT NULL REFERENCES oportunidades(id) ON DELETE CASCADE,
  finalidade TEXT NOT NULL CHECK (finalidade IN (
    'Venda','Locação','Permuta','Parceria','Lançamento','Incorporação','Loteamento')),
  ordem INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (oportunidade_id, finalidade)
);
CREATE INDEX idx_op_finalidades_op ON oportunidade_finalidades(oportunidade_id);

CREATE TABLE mensagens (
  id TEXT PRIMARY KEY,
  mensagem TEXT NOT NULL CHECK (length(mensagem) <= 4000),
  oportunidade_id TEXT NOT NULL REFERENCES oportunidades(id) ON DELETE CASCADE,
  de TEXT NOT NULL CHECK (de IN ('Admin','Parceiro')),
  data_hora TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  lida INTEGER NOT NULL DEFAULT 0 CHECK (lida IN (0,1))
);
CREATE INDEX idx_mensagens_oportunidade_id ON mensagens(oportunidade_id);
CREATE INDEX idx_mensagens_op_de_lida ON mensagens(oportunidade_id, de, lida);

CREATE TABLE avisos (
  id TEXT PRIMARY KEY,
  mensagem TEXT NOT NULL,
  data_hora TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE demandas (
  id TEXT PRIMARY KEY,
  titulo TEXT NOT NULL,
  tipo_imovel TEXT,
  localizacao_desejada TEXT,
  area_minima_m2 REAL,
  area_maxima_m2 REAL,
  valor_maximo REAL,
  descricao TEXT,
  visivel_parceiros INTEGER NOT NULL DEFAULT 0 CHECK (visivel_parceiros IN (0,1)),
  data_publicacao TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d','now'))
);
CREATE INDEX idx_demandas_visivel ON demandas(visivel_parceiros);

CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL CHECK (length(nome) <= 120),
  whatsapp TEXT NOT NULL CHECK (length(whatsapp) <= 30),
  token_usado TEXT NOT NULL,
  data_hora_acesso TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  parceiro_nome TEXT,
  parceiro_email TEXT,
  oportunidade_titulo TEXT,
  oportunidade_id TEXT REFERENCES oportunidades(id) ON DELETE SET NULL
);
CREATE INDEX idx_leads_oportunidade_id ON leads(oportunidade_id);
