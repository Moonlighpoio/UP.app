/**
 * UP · Catálogo SQLite versionado (Fases 2 y 3), sin dependencias externas.
 * ---------------------------------------------------------------------------
 * Fuente de verdad: data/catalog.sqlite.
 * data/catalog.json y data/demo.js son ARTEFACTOS derivados: se regeneran con
 * `npm run build-catalog` o `npm run export-catalog` y nunca se editan a mano.
 *
 * Regla de fallo seguro: todo precio heredado es referencial, por eso cada
 * oferta sembrada queda en status `pending` (sin priceSourceUrl ni
 * priceCapturedAt). Un registro `verified` exige las dos parejas de
 * procedencia (ficha/SKU y precio) y no puede estar vencido: pasado el TTL
 * pasa a `stale`. Triggers en SQL impiden marcar `verified` sin trazabilidad.
 * Los códigos PLU de 8 dígitos NO se disfrazan de GTIN EAN-13.
 */
const fs = require('node:fs');
const path = require('node:path');
const sqlite = require('node:sqlite');

const Database = sqlite.Database || sqlite.DatabaseSync;

const ROOT = path.resolve(__dirname, '..');
const CATALOG_SCHEMA_VERSION = '1.0.0';
const FEED_VERSION = '2026-11-24';
const FRESHNESS_TTL_MS = 15 * 60 * 1000; // Alineado con UP_FEED_TTL_MS en lib/feed.js.
const PRICTO_TTL_MS = 48 * 60 * 60 * 1000; // Pricto captura una vez al día (Fase 6).
const PRICE_SOURCE_TTL_MS = Object.freeze({ pricto: PRICTO_TTL_MS });
const FRESHNESS_POLICY =
  'Toda oferta verified necesita sourceUrl+capturedAt (identificador) y ' +
  'priceSourceUrl+priceCapturedAt (precio), además de priceSource y priceAttribution. ' +
  'TTL por fuente: 15 min para feeds en vivo y 48 h para Pricto (captura diaria); ' +
  'pasado ese TTL pasa a stale. pending nunca muestra precio verificado ni entra en "mejor precio".';
const CHAIN_ORDER = ['lider', 'jumbo', 'tottus', 'unimarc', 'santaisabel', 'coope'];
const OFFER_STATUSES = Object.freeze([
  'verified',
  'pending',
  'unavailable',
  'broken',
  'stale',
  'paused',
]);
const IDENTIFIER_KINDS = Object.freeze(['sku', 'gtin', 'plu']);
const DOMAIN_BY_CHAIN = {
  lider: 'lider.cl',
  jumbo: 'jumbo.cl',
  tottus: 'tottus.cl',
  unimarc: 'unimarc.cl',
  santaisabel: 'santaisabel.cl',
  coope: 'coope.cl',
};
// Espejo verificable de CHAIN_SEARCH en src/links.js. Jumbo usa ficha canónica
// y Coope no tiene patrón confirmado: ninguno de los dos entra aquí.
const SEARCH_BY_CHAIN = Object.freeze({
  lider: 'https://www.lider.cl/supermercado/busqueda?ft=',
  santaisabel: 'https://www.santaisabel.cl/busca?ft=',
  tottus: 'https://www.tottus.cl/tottus/busqueda?ft=',
  unimarc: 'https://www.unimarc.cl/busqueda?ft=',
});
const DATA_POLICY =
  'Solo datos autorizados. URL canónica o búsqueda exacta por SKU/GTIN/PLU verificado; nunca por nombre. ' +
  '403/429 pausa el conector y requiere renegociar acceso.';
const NOTE =
  'Datos de demostración creados por UP. FOTOS REFERENCIALES; precios referenciales, ' +
  'no oferta comercial. Ninguna oferta heredada está verificada.';
// Descripción neutra y propia: no reproduce textos de fichas de supermercados.
const DESCRIPTION_SOURCE = 'UP · texto propio (demo)';

const DB_FILE = path.join(ROOT, 'data', 'catalog.sqlite');
const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');
const LEGACY_FILE = path.join(ROOT, 'db', 'legacy', 'demo-2026-11-23.json');
const CATALOG_JSON_FILE = path.join(ROOT, 'data', 'catalog.json');
const DEMO_JS_FILE = path.join(ROOT, 'data', 'demo.js');
const LEGACY_SOURCE = 'db/legacy/demo-2026-11-23.json';
const DB_SOURCE = 'data/catalog.sqlite';

/** Dígito verificador EAN-13 (ponderación 1/3 sobre los primeros 12 dígitos). */
function ean13CheckDigit(body) {
  const total = body
    .split('')
    .reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (total % 10)) % 10;
}

function isEan13(value) {
  if (typeof value !== 'string' || !/^\d{13}$/.test(value)) return false;
  return ean13CheckDigit(value.slice(0, 12)) === Number(value[12]);
}

function isPlu(value) {
  return typeof value === 'string' && /^\d{8}$/.test(value);
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

/** TTL vigente para una fuente; las desconocidas usan el TTL corto por defecto. */
function ttlForSource(source, fallback = FRESHNESS_TTL_MS) {
  if (typeof source === 'string' && Object.hasOwn(PRICE_SOURCE_TTL_MS, source)) {
    return PRICE_SOURCE_TTL_MS[source];
  }
  return fallback;
}

/**
 * Estado de frescura de un timestamp ISO 8601. `future` es un error de datos:
 * ningún precio puede capturarse en el futuro.
 */
function freshnessInfo(iso, { now = Date.now, ttlMs = FRESHNESS_TTL_MS, source = null } = {}) {
  if (typeof iso !== 'string' || !iso.trim()) return { state: 'missing', ageMs: null };
  const captured = Date.parse(iso);
  if (!Number.isFinite(captured)) return { state: 'invalid', ageMs: null };
  const current = now();
  if (captured > current) return { state: 'future', ageMs: 0 };
  const ageMs = current - captured;
  return { state: ageMs > ttlForSource(source, ttlMs) ? 'stale' : 'fresh', ageMs };
}

/**
 * Pasa a `stale` las ofertas `verified` cuyo precio ya no es fresco.
 * Sólo degrada: nunca rehabilita un registro sin nueva evidencia.
 */
function applyFreshness(db, { now = Date.now, ttlMs = FRESHNESS_TTL_MS } = {}) {
  const verified = db
    .prepare("SELECT id, price_captured_at, price_source FROM offers WHERE status = 'verified'")
    .all();
  const stamp = new Date(now()).toISOString();
  const update = db.prepare("UPDATE offers SET status = 'stale', updated_at = ? WHERE id = ?");
  let changed = 0;
  db.exec('BEGIN');
  try {
    for (const row of verified) {
      const fresh = freshnessInfo(row.price_captured_at, {
        now,
        ttlMs,
        source: row.price_source,
      });
      if (fresh.state !== 'fresh') {
        update.run(stamp, row.id);
        changed += 1;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { checked: verified.length, changed };
}

/** Comprueba procedencia, frescura y coherencia de estados en la BD. */
function checkFreshness(db, { now = Date.now, ttlMs = FRESHNESS_TTL_MS } = {}) {
  const errors = [];
  const rows = db.prepare('SELECT * FROM offers').all();
  const summary = { verified: 0, pending: 0, stale: 0, other: 0 };
  for (const row of rows) {
    const label = `${row.product_id}/${row.chain_id}`;
    if (row.status === 'verified') {
      summary.verified += 1;
      if (!row.source_url || !row.captured_at || !row.price_source_url || !row.price_captured_at) {
        errors.push(`${label}: verified sin las dos parejas de procedencia`);
      }
      if (!row.price_source || !row.price_attribution) {
        errors.push(`${label}: verified sin fuente ni atribución de precio`);
      }
      const fresh = freshnessInfo(row.price_captured_at, {
        now,
        ttlMs,
        source: row.price_source,
      });
      if (fresh.state !== 'fresh') {
        const detail = fresh.state === 'stale' ? 'stale (vencido)' : fresh.state;
        errors.push(`${label}: verified con precio ${detail}; ejecutar reconciliación`);
      }
    } else if (row.status === 'pending') {
      summary.pending += 1;
      if (row.price_source_url || row.price_captured_at || row.price_source) {
        errors.push(`${label}: pending con precio capturado (contradicción de estado)`);
      }
    } else if (row.status === 'stale') {
      summary.stale += 1;
      if (!row.price_source_url || !row.price_captured_at) {
        errors.push(`${label}: stale sin procedencia de precio`);
      }
    } else {
      summary.other += 1;
    }
  }
  return { errors, summary, ttlMs, sourceTtlMs: PRICE_SOURCE_TTL_MS };
}

function migrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

function openCatalogDb({ file = DB_FILE, readOnly = false } = {}) {
  const db = new Database(file, { readOnly, enableForeignKeyConstraints: true });
  return db;
}

function ensureMigrationTable(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY) STRICT');
  return new Set(
    db
      .prepare('SELECT name FROM schema_migrations')
      .all()
      .map((row) => row.name)
  );
}

/** Aplica migraciones pendientes en orden, cada una en su propia transacción. */
function applyMigrations(db) {
  const applied = ensureMigrationTable(db);
  const files = migrationFiles();
  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    applied.add(name);
  }
  return files;
}

/** Crea una base vacía desde cero (para reconstruir el artefacto versionado). */
function createCatalogDb(file = DB_FILE) {
  if (file !== ':memory:' && fs.existsSync(file)) fs.unlinkSync(file);
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openCatalogDb({ file });
  applyMigrations(db);
  return db;
}

function loadLegacy() {
  if (!fs.existsSync(LEGACY_FILE)) {
    throw new Error(`Falta la instantánea heredada: ${path.relative(ROOT, LEGACY_FILE)}`);
  }
  const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
  if (
    !legacy ||
    !Array.isArray(legacy.products) ||
    !legacy.chains ||
    !Array.isArray(legacy.stores)
  ) {
    throw new Error('La instantánea heredada no tiene products/chains/stores');
  }
  return legacy;
}

function allowedSourceUrl(raw, chainId) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.protocol !== 'https:') return null;
    if (host !== DOMAIN_BY_CHAIN[chainId] && !host.endsWith('.' + DOMAIN_BY_CHAIN[chainId])) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Clasifica el identificador heredado sin inventar nada:
 *   - EAN-13 válido → gtin.
 *   - 8 dígitos → plu de granel (nunca gtin).
 *   - cualquier otro valor → error: requiere revisión humana.
 */
function legacyIdentifier(raw) {
  if (isEan13(raw)) return { kind: 'gtin', gtin: raw, plu: null, value: raw };
  if (isPlu(raw)) return { kind: 'plu', gtin: null, plu: raw, value: raw };
  throw new Error(`Identificador no verificable: ${JSON.stringify(raw)}`);
}

/** Siembra la BD con los 30 productos heredados. Todo queda `pending`. */
function seedCatalog(db, legacy = loadLegacy()) {
  const stamp = legacy.meta && legacy.meta.generatedAt ? legacy.meta.generatedAt : '1970-01-01';
  const metaRows = [
    ['schemaVersion', CATALOG_SCHEMA_VERSION],
    ['feedVersion', FEED_VERSION],
    ['meta', JSON.stringify(legacy.meta || {})],
    ['chains', JSON.stringify(legacy.chains)],
    ['stores', JSON.stringify(legacy.stores)],
    ['source', LEGACY_SOURCE],
    ['generatedAt', stamp],
    ['note', NOTE],
    ['dataPolicy', DATA_POLICY],
  ];
  const putMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  const putProduct = db.prepare(`
    INSERT INTO products (
      id, name, detail, description, description_source, image, category, emoji, unit_label,
      unit_amount, unit_name, gtin, identifier_kind, identifier_value, promos_json, sort_index,
      created_at, updated_at
    ) VALUES (
      @id, @name, @detail, @description, @description_source, @image, @category, @emoji, @unit_label,
      @unit_amount, @unit_name, @gtin, @identifier_kind, @identifier_value, @promos_json,
      @sort_index, @created_at, @updated_at
    )
  `);
  const putOffer = db.prepare(`
    INSERT INTO offers (
      product_id, chain_id, sku, gtin, plu, identifier_kind, identifier_value, price,
      currency, status, canonical_url, source_url, captured_at, price_source_url,
      price_captured_at, price_source, price_attribution, exact, note, created_at, updated_at
    ) VALUES (
      @product_id, @chain_id, @sku, @gtin, @plu, @identifier_kind, @identifier_value, @price,
      @currency, @status, @canonical_url, @source_url, @captured_at, @price_source_url,
      @price_captured_at, @price_source, @price_attribution, @exact, @note, @created_at, @updated_at
    )
  `);
  const putMatch = db.prepare(`
    INSERT INTO match_queue (
      product_id, chain_id, gtin, sku, plu, candidate_url, status, reason, created_at, updated_at
    ) VALUES (
      @product_id, @chain_id, @gtin, @sku, @plu, @candidate_url, @status, @reason,
      @created_at, @updated_at
    )
  `);
  const putUrl = db.prepare(`
    INSERT INTO url_queue (
      product_id, chain_id, url, status, http_status, checked_at, last_error, created_at, updated_at
    ) VALUES (
      @product_id, @chain_id, @url, @status, @http_status, @checked_at, @last_error,
      @created_at, @updated_at
    )
  `);

  db.exec('BEGIN');
  try {
    for (const [key, value] of metaRows) putMeta.run(key, value);
    legacy.products.forEach((product, index) => {
      const raw = product.skus && product.skus.jumbo && product.skus.jumbo.gtin;
      const id = legacyIdentifier(raw);
      putProduct.run({
        id: product.id,
        name: product.name,
        detail: product.detail,
        description: product.description,
        description_source: DESCRIPTION_SOURCE,
        image: product.image,
        category: product.category,
        emoji: product.emoji,
        unit_label: product.unitLabel,
        unit_amount: product.unitAmount,
        unit_name: product.unitName,
        gtin: id.gtin,
        identifier_kind: id.kind,
        identifier_value: id.value,
        promos_json: JSON.stringify(product.promos || {}),
        sort_index: index,
        created_at: stamp,
        updated_at: stamp,
      });

      for (const chainId of CHAIN_ORDER) {
        const mapping = (product.skus && product.skus[chainId]) || {};
        const price = product.prices && product.prices[chainId];
        if (!isPositiveInt(price)) {
          throw new Error(`${product.id}/${chainId}: precio CLP inválido ${JSON.stringify(price)}`);
        }
        const sku = typeof mapping.sku === 'string' && mapping.sku ? mapping.sku : null;
        const sourceUrl =
          chainId === 'jumbo' && mapping.url ? allowedSourceUrl(mapping.url, chainId) : null;
        if (chainId === 'jumbo' && mapping.url && !sourceUrl) {
          throw new Error(`${product.id}: URL canónica fuera de la whitelist (${mapping.url})`);
        }
        const capturedAt = chainId === 'jumbo' && mapping.verifiedAt ? mapping.verifiedAt : null;
        const kind = sku ? 'sku' : id.kind;
        const value = sku || id.value;
        const noteForChain =
          id.kind === 'plu'
            ? 'PLU de granel: confirmar identificador en ficha; precio sin fuente verificable'
            : sku
              ? 'SKU y ficha mapeados; precio referencial sin fuente verificable'
              : 'Identificador universal provisional; sin SKU propio verificado';

        putOffer.run({
          product_id: product.id,
          chain_id: chainId,
          sku,
          gtin: id.gtin,
          plu: id.plu,
          identifier_kind: kind,
          identifier_value: value,
          price,
          currency: 'CLP',
          status: 'pending',
          canonical_url: sourceUrl,
          source_url: sourceUrl,
          captured_at: capturedAt,
          price_source_url: null,
          price_captured_at: null,
          price_source: null,
          price_attribution: null,
          exact: chainId === 'jumbo' && mapping.exact === true ? 1 : 0,
          note: noteForChain,
          created_at: stamp,
          updated_at: stamp,
        });

        if (chainId !== 'jumbo' || id.kind === 'plu') {
          putMatch.run({
            product_id: product.id,
            chain_id: chainId,
            gtin: id.gtin,
            sku: null,
            plu: id.plu,
            candidate_url: null,
            status: 'pending',
            reason:
              id.kind === 'plu'
                ? 'PLU de granel: verificar identificador y ficha de la cadena'
                : 'Sin SKU propio verificado en ficha; el identificador universal es provisional',
            created_at: stamp,
            updated_at: stamp,
          });
        }
        const searchPrefix = SEARCH_BY_CHAIN[chainId];
        const queueUrl =
          sourceUrl || (searchPrefix ? searchPrefix + encodeURIComponent(value) : null);
        if (queueUrl) {
          putUrl.run({
            product_id: product.id,
            chain_id: chainId,
            url: queueUrl,
            status: 'pending',
            http_status: null,
            checked_at: null,
            last_error: null,
            created_at: stamp,
            updated_at: stamp,
          });
        }
      }
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return db;
}

/** Construye la BD versionada desde cero y valida el resultado. */
function buildCatalogDb(file = DB_FILE) {
  const db = createCatalogDb(file);
  try {
    seedCatalog(db);
    const { errors } = validateDb(db);
    if (errors.length) throw new Error(errors.join('; '));
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`JSON inválido en ${label}`);
  }
}

function metaMap(db) {
  return Object.fromEntries(
    db
      .prepare('SELECT key, value FROM meta ORDER BY key')
      .all()
      .map((row) => [row.key, row.value])
  );
}

/** Exporta la BD a un objeto estable y versionado (data/catalog.json). */
function readCatalog(db) {
  const meta = metaMap(db);
  const originalMeta = parseJson(meta.meta, 'meta.meta');
  const chains = parseJson(meta.chains, 'meta.chains');
  const stores = parseJson(meta.stores, 'meta.stores');
  const productRows = db.prepare('SELECT * FROM products ORDER BY sort_index').all();
  const offerRows = db.prepare('SELECT * FROM offers').all();
  const byProduct = new Map();
  for (const offer of offerRows) {
    if (!byProduct.has(offer.product_id)) byProduct.set(offer.product_id, []);
    byProduct.get(offer.product_id).push(offer);
  }
  const rank = Object.fromEntries(CHAIN_ORDER.map((chainId, index) => [chainId, index]));
  const products = productRows.map((row) => ({
    id: row.id,
    name: row.name,
    detail: row.detail,
    description: row.description,
    descriptionSource: row.description_source || DESCRIPTION_SOURCE,
    image: row.image,
    category: row.category,
    emoji: row.emoji,
    unitLabel: row.unit_label,
    unitAmount: row.unit_amount,
    unitName: row.unit_name,
    identifier: { kind: row.identifier_kind, value: row.identifier_value, gtin: row.gtin },
    promos: parseJson(row.promos_json, `promos de ${row.id}`),
    offers: (byProduct.get(row.id) || [])
      .slice()
      .sort((a, b) => (rank[a.chain_id] ?? 99) - (rank[b.chain_id] ?? 99))
      .map((offer) => ({
        chainId: offer.chain_id,
        sku: offer.sku,
        gtin: offer.gtin,
        plu: offer.plu,
        identifierKind: offer.identifier_kind,
        identifierValue: offer.identifier_value,
        price: offer.price,
        currency: offer.currency,
        status: offer.status,
        canonicalUrl: offer.canonical_url,
        sourceUrl: offer.source_url,
        capturedAt: offer.captured_at,
        priceSourceUrl: offer.price_source_url,
        priceCapturedAt: offer.price_captured_at,
        priceSource: offer.price_source,
        priceAttribution: offer.price_attribution,
        exact: offer.exact === 1,
        note: offer.note,
      })),
  }));

  const counts = {
    products: productRows.length,
    offers: offerRows.length,
    matchQueue: db.prepare('SELECT COUNT(*) AS n FROM match_queue').get().n,
    urlQueue: db.prepare('SELECT COUNT(*) AS n FROM url_queue').get().n,
    chains: Object.keys(chains).length,
    stores: stores.length,
  };
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    feedVersion: meta.feedVersion || FEED_VERSION,
    meta: {
      mode: 'demo',
      generatedAt: meta.generatedAt || originalMeta.generatedAt || null,
      currency: originalMeta.currency || 'CLP',
      locale: originalMeta.locale || 'es-CL',
      note: meta.note || NOTE,
      source: LEGACY_SOURCE,
      catalogSource: DB_SOURCE,
      dataPolicy: DATA_POLICY,
      freshness: {
        ttlMs: FRESHNESS_TTL_MS,
        sourceTtlMs: PRICE_SOURCE_TTL_MS,
        policy: FRESHNESS_POLICY,
      },
      counts,
    },
    chains,
    stores,
    products,
  };
}

/** Convierte el catálogo versionado al contrato que ya consume el front-end. */
function toFrontPayload(catalog) {
  const products = catalog.products.map((product) => {
    const skus = {};
    const prices = {};
    for (const offer of product.offers) {
      skus[offer.chainId] = {
        sku: offer.sku,
        gtin: offer.gtin,
        plu: offer.plu,
        url: offer.canonicalUrl,
        exact: offer.exact,
        status: offer.status,
        ...(offer.capturedAt ? { verifiedAt: offer.capturedAt } : {}),
        ...(offer.priceSource === 'pricto'
          ? {
              priceSource: offer.priceSource,
              priceAttribution: offer.priceAttribution,
              priceCapturedAt: offer.priceCapturedAt,
              priceSourceUrl: offer.priceSourceUrl,
              priceRetailerUrl: offer.sourceUrl,
            }
          : {}),
      };
      prices[offer.chainId] = offer.price;
    }
    return {
      id: product.id,
      name: product.name,
      detail: product.detail,
      description: product.description,
      descriptionSource: product.descriptionSource || DESCRIPTION_SOURCE,
      image: product.image,
      skus,
      category: product.category,
      emoji: product.emoji,
      unitLabel: product.unitLabel,
      unitAmount: product.unitAmount,
      unitName: product.unitName,
      prices,
      promos: product.promos,
    };
  });
  return {
    meta: {
      mode: 'demo',
      generatedAt: catalog.meta.generatedAt,
      note: catalog.meta.note,
      currency: catalog.meta.currency,
      locale: catalog.meta.locale,
    },
    chains: catalog.chains,
    stores: catalog.stores,
    products,
  };
}

function renderDemoJs(catalog) {
  const header = [
    '/**',
    ' * UP · ARTEFACTO GENERADO desde data/catalog.sqlite (Fases 2, 3 y 6).',
    ' * No editar a mano: npm run build-catalog o npm run export-catalog.',
    ' * Precios referenciales salvo ofertas verificadas con atribución. Ver README.',
    ' */',
  ].join('\n');
  return (
    header + '\nwindow.UP_DEMO_DATA = ' + JSON.stringify(toFrontPayload(catalog), null, 2) + ';\n'
  );
}

/** Validación estructural del catálogo exportado (errores = bloqueantes). */
function validateCatalogObject(catalog, { now = Date.now, ttlMs = FRESHNESS_TTL_MS } = {}) {
  const errors = [];
  if (!catalog || typeof catalog !== 'object') return ['catálogo ausente'];
  if (catalog.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    errors.push(`schemaVersion esperado ${CATALOG_SCHEMA_VERSION}, got ${catalog.schemaVersion}`);
  }
  if (!catalog.meta || !catalog.meta.counts) errors.push('meta.counts ausente');
  if (
    !catalog.meta?.freshness ||
    catalog.meta.freshness.ttlMs !== FRESHNESS_TTL_MS ||
    catalog.meta.freshness.sourceTtlMs?.pricto !== PRICTO_TTL_MS ||
    typeof catalog.meta.freshness.policy !== 'string'
  ) {
    errors.push('meta.freshness ausente o inválido');
  }
  if (!catalog.chains || !Array.isArray(catalog.stores) || !Array.isArray(catalog.products)) {
    errors.push('chains/stores/products ausentes');
    return errors;
  }
  if (Object.keys(catalog.chains).some((id) => !CHAIN_ORDER.includes(id))) {
    errors.push('cadena desconocida en chains');
  }
  const ids = new Set();
  for (const product of catalog.products) {
    if (!product.id || ids.has(product.id)) errors.push(`id duplicado/vacío: ${product.id}`);
    ids.add(product.id);
    if (typeof product.description !== 'string' || !product.description.trim()) {
      errors.push(`${product.id}: descripción vacía`);
    }
    if (typeof product.descriptionSource !== 'string' || !product.descriptionSource.trim()) {
      errors.push(`${product.id}: descriptionSource vacío`);
    }
    if (
      typeof product.unitAmount !== 'number' ||
      !Number.isFinite(product.unitAmount) ||
      product.unitAmount <= 0
    ) {
      errors.push(`${product.id}: unitAmount inválido`);
    }
    const identifier = product.identifier || {};
    if (identifier.kind === 'gtin' && !isEan13(identifier.gtin)) {
      errors.push(`${product.id}: gtin no es EAN-13 válido (${identifier.gtin})`);
    }
    if (identifier.kind === 'plu' && (!isPlu(identifier.value) || identifier.gtin !== null)) {
      errors.push(`${product.id}: PLU inválido o gtin no nulo`);
    }
    if (!IDENTIFIER_KINDS.includes(identifier.kind)) {
      errors.push(`${product.id}: identifierKind desconocido`);
    }
    if (!Array.isArray(product.offers) || product.offers.length !== CHAIN_ORDER.length) {
      errors.push(`${product.id}: ofertas incompletas`);
      continue;
    }
    const seen = new Set();
    for (const offer of product.offers) {
      if (seen.has(offer.chainId)) errors.push(`${product.id}: cadena duplicada ${offer.chainId}`);
      seen.add(offer.chainId);
      if (!CHAIN_ORDER.includes(offer.chainId)) {
        errors.push(`${product.id}: cadena desconocida ${offer.chainId}`);
      }
      if (!isPositiveInt(offer.price))
        errors.push(`${product.id}/${offer.chainId}: precio inválido`);
      if (offer.currency !== 'CLP') errors.push(`${product.id}/${offer.chainId}: moneda inválida`);
      if (!OFFER_STATUSES.includes(offer.status)) {
        errors.push(`${product.id}/${offer.chainId}: status inválido`);
      }
      if (offer.status === 'verified') {
        if (
          !offer.sourceUrl ||
          !offer.capturedAt ||
          !offer.priceSourceUrl ||
          !offer.priceCapturedAt
        ) {
          errors.push(
            `${product.id}/${offer.chainId}: verified sin las dos parejas de procedencia`
          );
        }
        if (!offer.priceSource || !offer.priceAttribution) {
          errors.push(`${product.id}/${offer.chainId}: verified sin fuente ni atribución`);
        }
        const fresh = freshnessInfo(offer.priceCapturedAt, {
          now,
          ttlMs,
          source: offer.priceSource,
        });
        if (fresh.state !== 'fresh') {
          errors.push(`${product.id}/${offer.chainId}: verified con precio ${fresh.state}`);
        }
      } else if (offer.status === 'pending') {
        if (offer.priceSourceUrl || offer.priceCapturedAt) {
          errors.push(`${product.id}/${offer.chainId}: pending con precio capturado`);
        }
      } else if (offer.status === 'stale') {
        if (!offer.priceSourceUrl || !offer.priceCapturedAt) {
          errors.push(`${product.id}/${offer.chainId}: stale sin procedencia de precio`);
        }
      }
      if (offer.gtin !== null && !isEan13(offer.gtin)) {
        errors.push(`${product.id}/${offer.chainId}: gtin no EAN-13`);
      }
      if (offer.canonicalUrl && !allowedSourceUrl(offer.canonicalUrl, offer.chainId)) {
        errors.push(`${product.id}/${offer.chainId}: canonicalUrl fuera de whitelist`);
      }
    }
  }
  return errors;
}

/** Validación de la BD: esquema, migraciones, índices, datos y consistencia. */
function validateDb(db, { now = Date.now, ttlMs = FRESHNESS_TTL_MS } = {}) {
  const errors = [];
  const objects = db
    .prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
    .all();
  const tables = new Set(objects.filter((row) => row.type === 'table').map((row) => row.name));
  const indexes = new Set(objects.filter((row) => row.type === 'index').map((row) => row.name));
  for (const table of ['products', 'offers', 'match_queue', 'url_queue', 'meta']) {
    if (!tables.has(table)) errors.push(`falta tabla ${table}`);
  }
  for (const index of [
    'idx_products_gtin',
    'idx_offers_gtin',
    'idx_offers_chain_sku',
    'idx_offers_product_url',
    'idx_url_queue_product_url',
  ]) {
    if (!indexes.has(index)) errors.push(`falta índice ${index}`);
  }
  const migrations = db.prepare('SELECT name FROM schema_migrations').all().length;
  if (migrations !== migrationFiles().length) {
    errors.push(`migraciones aplicadas ${migrations}/${migrationFiles().length}`);
  }
  const triggers = new Set(objects.filter((row) => row.type === 'trigger').map((row) => row.name));
  for (const name of [
    'offers_verified_provenance_insert',
    'offers_verified_provenance_update',
    'offers_verified_attribution_insert',
    'offers_verified_attribution_update',
  ]) {
    if (!triggers.has(name)) errors.push(`falta trigger ${name}`);
  }
  const badProducts = db.prepare('SELECT id, gtin FROM products WHERE gtin IS NOT NULL').all();
  for (const row of badProducts) {
    if (!isEan13(row.gtin)) errors.push(`${row.id}: gtin inválido en BD`);
  }
  const rows = db.prepare('SELECT * FROM offers').all();
  for (const row of rows) {
    if (!isPositiveInt(row.price)) errors.push(`${row.product_id}/${row.chain_id}: price inválido`);
    if (!OFFER_STATUSES.includes(row.status)) {
      errors.push(`${row.product_id}/${row.chain_id}: status inválido`);
    }
    if (
      row.status === 'verified' &&
      (!row.source_url || !row.captured_at || !row.price_source_url || !row.price_captured_at)
    ) {
      errors.push(`${row.product_id}/${row.chain_id}: verified sin trazabilidad`);
    }
  }
  const { errors: freshnessErrors } = checkFreshness(db, { now, ttlMs });
  errors.push(...freshnessErrors.map((error) => `freshness: ${error}`));

  const productsById = new Map(
    db
      .prepare('SELECT id, gtin, identifier_kind, identifier_value FROM products')
      .all()
      .map((row) => [row.id, row])
  );
  const offersByKey = new Map(rows.map((row) => [`${row.product_id}/${row.chain_id}`, row]));
  const matchByKey = new Map();
  for (const row of db.prepare('SELECT * FROM match_queue').all()) {
    const key = `${row.product_id}/${row.chain_id}`;
    if (matchByKey.has(key)) errors.push(`match_queue duplicado: ${key}`);
    matchByKey.set(key, row);
    const product = productsById.get(row.product_id);
    const offer = offersByKey.get(key);
    if (!product) errors.push(`match_queue huérfano (sin producto): ${key}`);
    if (!offer) errors.push(`match_queue huérfano (sin oferta): ${key}`);
    if (!CHAIN_ORDER.includes(row.chain_id)) errors.push(`match_queue cadena desconocida: ${key}`);
    if (product && product.identifier_kind === 'plu') {
      if (row.plu !== product.identifier_value || row.gtin !== null) {
        errors.push(`match_queue PLU inconsistente: ${key}`);
      }
    } else if (product && (row.gtin !== product.gtin || row.plu !== null)) {
      errors.push(`match_queue GTIN inconsistente: ${key}`);
    }
  }
  for (const row of rows) {
    const product = productsById.get(row.product_id);
    if (!product) continue;
    const key = `${row.product_id}/${row.chain_id}`;
    const needsMatch = row.chain_id !== 'jumbo' || product.identifier_kind === 'plu';
    if (needsMatch && !matchByKey.has(key)) {
      errors.push(`match_queue ausente: ${key}`);
    } else if (!needsMatch && matchByKey.has(key)) {
      errors.push(`match_queue sobrante: ${key}`);
    }
  }
  const urlByKey = new Map();
  for (const row of db.prepare('SELECT * FROM url_queue').all()) {
    const key = `${row.product_id}/${row.chain_id}`;
    const offer = offersByKey.get(key);
    if (!offer) {
      errors.push(`url_queue huérfano (sin oferta): ${key}`);
      continue;
    }
    if (urlByKey.has(key)) errors.push(`url_queue duplicado: ${key}`);
    urlByKey.set(key, row);
    const prefix = SEARCH_BY_CHAIN[row.chain_id];
    const expected =
      row.chain_id === 'jumbo'
        ? offer.canonical_url
        : prefix
          ? prefix + encodeURIComponent(offer.identifier_value)
          : null;
    if (!expected) errors.push(`url_queue sin patrón verificado: ${key}`);
    else if (row.url !== expected) errors.push(`url_queue no derivado del identificador: ${key}`);
  }
  for (const row of rows) {
    const key = `${row.product_id}/${row.chain_id}`;
    const expectedUrl = row.chain_id === 'jumbo' || Boolean(SEARCH_BY_CHAIN[row.chain_id]);
    if (expectedUrl && !urlByKey.has(key)) errors.push(`url_queue ausente: ${key}`);
    if (!expectedUrl && urlByKey.has(key)) errors.push(`url_queue sobrante: ${key}`);
  }

  let catalog = null;
  if (!errors.length) {
    catalog = readCatalog(db);
    errors.push(...validateCatalogObject(catalog, { now, ttlMs }));
  }
  return { errors, catalog };
}

/** Escribe los artefactos derivados de la BD. */
function exportArtifacts(catalog) {
  fs.writeFileSync(CATALOG_JSON_FILE, JSON.stringify(catalog, null, 2) + '\n');
  fs.writeFileSync(DEMO_JS_FILE, renderDemoJs(catalog));
  return {
    catalogJson: path.relative(ROOT, CATALOG_JSON_FILE),
    demoJs: path.relative(ROOT, DEMO_JS_FILE),
  };
}

/** Lectura usada por server.js: devuelve el contrato histórico de data/demo.js. */
function readCatalogPayload() {
  const db = openCatalogDb({ readOnly: true });
  try {
    const { errors, catalog } = validateDb(db);
    if (errors.length) throw new Error('Catálogo inválido: ' + errors.join('; '));
    return toFrontPayload(catalog);
  } finally {
    db.close();
  }
}

module.exports = {
  CATALOG_SCHEMA_VERSION,
  FEED_VERSION,
  CHAIN_ORDER,
  SEARCH_BY_CHAIN,
  OFFER_STATUSES,
  IDENTIFIER_KINDS,
  DATA_POLICY,
  FRESHNESS_TTL_MS,
  PRICTO_TTL_MS,
  PRICE_SOURCE_TTL_MS,
  FRESHNESS_POLICY,
  DB_FILE,
  LEGACY_FILE,
  CATALOG_JSON_FILE,
  DEMO_JS_FILE,
  LEGACY_SOURCE,
  DB_SOURCE,
  ean13CheckDigit,
  isEan13,
  isPlu,
  freshnessInfo,
  ttlForSource,
  applyFreshness,
  checkFreshness,
  applyMigrations,
  buildCatalogDb,
  createCatalogDb,
  exportArtifacts,
  loadLegacy,
  openCatalogDb,
  readCatalog,
  readCatalogPayload,
  renderDemoJs,
  seedCatalog,
  toFrontPayload,
  validateCatalogObject,
  validateDb,
};
