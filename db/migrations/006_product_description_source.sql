-- UP · Origen de la descripción propia del producto (FASE A).
-- No es una copia de fichas comerciales: se genera a partir de tipo, marca y
-- formato del catálogo de demostración. Nunca sustituye datos nutricionales.
ALTER TABLE products ADD COLUMN description_source TEXT NOT NULL DEFAULT 'UP · texto propio (demo)';
