-- UP · Catálogo versionado (Fase 2), migración 001.
-- Fuente de verdad: data/catalog.sqlite. Este SQL se aplica una sola vez y
-- reproduciblemente desde scripts/catalog-db.js (tabla schema_migrations).
--
-- Reglas de integridad:
--   * gtin sólo EAN-13 de 13 dígitos; el dígito verificador se valida en JS.
--   * price = entero positivo en CLP; nunca se almacena 0 ni negativo.
--   * status ∈ verified | pending | unavailable | broken | stale | paused.
--   * verified exige sourceUrl + capturedAt + priceCapturedAt (fallo seguro).
--   * Los PLU de granel NO se inventan como GTIN: van en su propia columna.

-- La tabla schema_migrations la crea el runner antes de aplicar esta migración.
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  detail TEXT NOT NULL,
  description TEXT NOT NULL,
  image TEXT NOT NULL,
  category TEXT NOT NULL,
  emoji TEXT NOT NULL,
  unit_label TEXT NOT NULL,
  unit_amount REAL NOT NULL CHECK (unit_amount > 0),
  unit_name TEXT NOT NULL,
  gtin TEXT CHECK (gtin IS NULL OR (length(gtin) = 13 AND gtin NOT GLOB '*[^0-9]*')),
  identifier_kind TEXT NOT NULL CHECK (identifier_kind IN ('gtin', 'plu')),
  identifier_value TEXT NOT NULL,
  promos_json TEXT NOT NULL DEFAULT '{}',
  sort_index INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  chain_id TEXT NOT NULL,
  sku TEXT,
  gtin TEXT,
  plu TEXT,
  identifier_kind TEXT NOT NULL CHECK (identifier_kind IN ('sku', 'gtin', 'plu')),
  identifier_value TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0),
  currency TEXT NOT NULL DEFAULT 'CLP' CHECK (currency = 'CLP'),
  status TEXT NOT NULL CHECK (
    status IN ('verified', 'pending', 'unavailable', 'broken', 'stale', 'paused')
  ),
  canonical_url TEXT,
  source_url TEXT,
  captured_at TEXT,
  price_captured_at TEXT,
  exact INTEGER NOT NULL DEFAULT 0 CHECK (exact IN (0, 1)),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (product_id, chain_id),
  CHECK (
    status <> 'verified'
    OR (source_url IS NOT NULL AND captured_at IS NOT NULL AND price_captured_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE match_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  chain_id TEXT NOT NULL,
  gtin TEXT,
  sku TEXT,
  plu TEXT,
  candidate_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('verified', 'pending', 'unavailable', 'broken', 'stale', 'paused')
  ),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE url_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  chain_id TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('verified', 'pending', 'unavailable', 'broken', 'stale', 'paused')
  ),
  http_status INTEGER,
  checked_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- Índices exigidos: gtin, chain+sku y product_url.
CREATE INDEX idx_products_gtin ON products (gtin);
CREATE INDEX idx_products_identifier ON products (identifier_kind, identifier_value);
CREATE INDEX idx_offers_gtin ON offers (gtin);
CREATE INDEX idx_offers_chain_sku ON offers (chain_id, sku);
CREATE INDEX idx_offers_product_url ON offers (product_id, canonical_url);
CREATE INDEX idx_match_queue_product_chain ON match_queue (product_id, chain_id);
CREATE INDEX idx_url_queue_product_url ON url_queue (product_id, url);
