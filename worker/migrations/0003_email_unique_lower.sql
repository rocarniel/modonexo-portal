-- O índice único de e-mail era case-sensitive, mas toda a aplicação trata
-- e-mail como case-insensitive (lower(email) em todas as buscas). Sem isso,
-- "Foo@Bar.com" e "foo@bar.com" poderiam existir como dois parceiros
-- distintos, e buscas por lower(email) ficariam ambíguas entre os dois.

DROP INDEX idx_parceiros_email;
DROP INDEX idx_parceiros_email_lower;
CREATE UNIQUE INDEX idx_parceiros_email_lower ON parceiros(lower(email));
