-- UP · Fase 6: fuente del precio y atribución verificable.
--
-- price_source        → identificador de la fuente autorizada (p. ej. `pricto`).
-- price_attribution   → línea de atribución obligatoria devuelta por la fuente.
--
-- La captura de Pricto es diaria: su TTL se define en código (48 h) y no se
-- falsifica la hora de observación. Un `verified` sin fuente ni atribución no
-- puede publicarse: los triggers lo impiden también por escrituras directas.

ALTER TABLE offers ADD COLUMN price_source TEXT;
ALTER TABLE offers ADD COLUMN price_attribution TEXT;

CREATE TRIGGER offers_verified_attribution_insert
BEFORE INSERT ON offers
WHEN NEW.status = 'verified'
  AND (NEW.price_source IS NULL OR NEW.price_attribution IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'verified requiere price_source y price_attribution');
END;

CREATE TRIGGER offers_verified_attribution_update
BEFORE UPDATE OF status, price_source, price_attribution ON offers
WHEN NEW.status = 'verified'
  AND (NEW.price_source IS NULL OR NEW.price_attribution IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'verified requiere price_source y price_attribution');
END;
