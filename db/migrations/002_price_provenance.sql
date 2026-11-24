-- UP · Fase 3: procedencia explícita del PRECIO, separada de la ficha/SKU.
--
-- source_url + captured_at       → origen del identificador / ficha canónica.
-- price_source_url + price_captured_at → origen del precio (feed autorizado).
--
-- Un registro `verified` exige AMBAS parejas. Los triggers impiden marcar
-- verified "porque sí", incluso si alguien escribe directamente en la BD.

ALTER TABLE offers ADD COLUMN price_source_url TEXT;

CREATE TRIGGER offers_verified_provenance_insert
BEFORE INSERT ON offers
WHEN NEW.status = 'verified'
  AND (
    NEW.source_url IS NULL
    OR NEW.captured_at IS NULL
    OR NEW.price_source_url IS NULL
    OR NEW.price_captured_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'verified requiere sourceUrl/capturedAt y priceSourceUrl/priceCapturedAt');
END;

CREATE TRIGGER offers_verified_provenance_update
BEFORE UPDATE OF status, source_url, captured_at, price_source_url, price_captured_at ON offers
WHEN NEW.status = 'verified'
  AND (
    NEW.source_url IS NULL
    OR NEW.captured_at IS NULL
    OR NEW.price_source_url IS NULL
    OR NEW.price_captured_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'verified requiere sourceUrl/capturedAt y priceSourceUrl/priceCapturedAt');
END;
