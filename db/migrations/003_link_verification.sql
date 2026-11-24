-- UP · Fase 4: evidencia de verificación de enlaces por cadena piloto.
-- No cambia el estado de las ofertas ni los precios: verificar un enlace
-- sólo acredita que la ficha existe, nunca que el precio esté confirmado.

ALTER TABLE url_queue ADD COLUMN etag TEXT;
ALTER TABLE url_queue ADD COLUMN last_modified TEXT;
ALTER TABLE url_queue ADD COLUMN final_url TEXT;
ALTER TABLE url_queue ADD COLUMN robots_status TEXT;
ALTER TABLE url_queue ADD COLUMN robots_checked_at TEXT;
