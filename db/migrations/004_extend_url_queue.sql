-- UP · Fase 5: extiende url_queue a las cadenas con patrón de búsqueda verificado.
-- Las URLs se derivan SOLO del identificador ya presente en offers (GTIN/PLU)
-- y del patrón vigente en src/links.js. Nunca se usa el nombre del producto.
-- Coope no tiene patrón confirmado: no se inserta ninguna URL inventada.
-- Jumbo ya tiene su ficha canónica y no se duplica.

INSERT INTO url_queue (
  product_id, chain_id, url, status, http_status, checked_at, last_error, created_at, updated_at
)
SELECT
  o.product_id,
  o.chain_id,
  CASE o.chain_id
    WHEN 'lider' THEN 'https://www.lider.cl/supermercado/busqueda?ft='
    WHEN 'santaisabel' THEN 'https://www.santaisabel.cl/busca?ft='
    WHEN 'tottus' THEN 'https://www.tottus.cl/tottus/busqueda?ft='
    WHEN 'unimarc' THEN 'https://www.unimarc.cl/busqueda?ft='
  END || COALESCE(o.identifier_value, o.gtin, o.plu),
  'pending',
  NULL,
  NULL,
  NULL,
  o.created_at,
  o.updated_at
FROM offers AS o
WHERE o.chain_id IN ('lider', 'santaisabel', 'tottus', 'unimarc')
  AND COALESCE(o.identifier_value, o.gtin, o.plu) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM url_queue AS u
    WHERE u.product_id = o.product_id AND u.chain_id = o.chain_id
  );
