-- Rate limiting migrado de KV (get-then-put, não atômico, sujeito a race
-- condition sob requisições paralelas) para uma tabela D1 com UPSERT atômico
-- (INSERT ... ON CONFLICT ... RETURNING é uma única instrução SQL, atômica).

CREATE TABLE rate_limits (
  chave TEXT PRIMARY KEY,
  contagem INTEGER NOT NULL DEFAULT 1,
  inicio INTEGER NOT NULL
);
CREATE INDEX idx_rate_limits_inicio ON rate_limits(inicio);
