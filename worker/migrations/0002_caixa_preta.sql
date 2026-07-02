-- Arquivo histórico de parceiros excluídos definitivamente.
-- Guarda um snapshot completo (parceiro + oportunidades + finalidades + mensagens + leads)
-- antes da exclusão física dos dados, para preservar histórico mesmo após remoção.

CREATE TABLE caixa_preta (
  id TEXT PRIMARY KEY,
  parceiro_id_original TEXT NOT NULL,
  nome_completo TEXT NOT NULL,
  email TEXT NOT NULL,
  dados_json TEXT NOT NULL,
  excluido_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  excluido_por TEXT NOT NULL
);
CREATE INDEX idx_caixa_preta_email ON caixa_preta(email);
CREATE INDEX idx_caixa_preta_parceiro_id ON caixa_preta(parceiro_id_original);
