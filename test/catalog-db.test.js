import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  CATALOG_SCHEMA_VERSION,
  CHAIN_ORDER,
  SEARCH_BY_CHAIN,
  FRESHNESS_TTL_MS,
  PRICTO_TTL_MS,
  buildCatalogDb,
  checkFreshness,
  createCatalogDb,
  ean13CheckDigit,
  applyFreshness,
  freshnessInfo,
  ttlForSource,
  isEan13,
  isPlu,
  readCatalog,
  readCatalogPayload,
  renderDemoJs,
  seedCatalog,
  toFrontPayload,
  validateCatalogObject,
  validateDb,
} = require('../scripts/catalog-db.js');

function seeded() {
  const db = createCatalogDb(':memory:');
  seedCatalog(db);
  return db;
}

test('EAN-13: dígito verificador y rechazo de PLU de 8 dígitos', () => {
  assert.equal(ean13CheckDigit('780161000162'), 2);
  assert.equal(isEan13('7801610001622'), true);
  assert.equal(isEan13('7801610001623'), false);
  assert.equal(isEan13('24851794'), false);
  assert.equal(isPlu('24851794'), true);
  assert.equal(isPlu('7801610001622'), false);
});

test('migraciones crean tablas, índices, triggers y registran 001 a 006', () => {
  const db = seeded();
  try {
    const { errors } = validateDb(db);
    assert.deepEqual(errors, []);
    const objects = db
      .prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => row.name);
    for (const name of [
      'products',
      'offers',
      'match_queue',
      'url_queue',
      'idx_products_gtin',
      'idx_offers_gtin',
      'idx_offers_chain_sku',
      'idx_offers_product_url',
      'idx_url_queue_product_url',
      'offers_verified_provenance_insert',
      'offers_verified_provenance_update',
      'offers_verified_attribution_insert',
      'offers_verified_attribution_update',
    ]) {
      assert.ok(objects.includes(name), name);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 6);
    const offerColumns = db
      .prepare('PRAGMA table_info(offers)')
      .all()
      .map((row) => row.name);
    assert.ok(offerColumns.includes('price_source'));
    assert.ok(offerColumns.includes('price_attribution'));
    const urlColumns = db
      .prepare('PRAGMA table_info(url_queue)')
      .all()
      .map((row) => row.name);
    for (const column of [
      'etag',
      'last_modified',
      'final_url',
      'robots_status',
      'robots_checked_at',
    ]) {
      assert.ok(urlColumns.includes(column), column);
    }
  } finally {
    db.close();
  }
});

test('siembra 30 productos, 180 ofertas pendientes y 150 enlaces derivados del identificador', () => {
  const db = seeded();
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products').get().n, 30);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM offers').get().n, 180);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM match_queue').get().n, 153);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM url_queue').get().n, 150);
    const byChain = Object.fromEntries(
      db
        .prepare('SELECT chain_id, COUNT(*) AS n FROM url_queue GROUP BY chain_id')
        .all()
        .map((row) => [row.chain_id, row.n])
    );
    assert.deepEqual(byChain, {
      jumbo: 30,
      lider: 30,
      santaisabel: 30,
      tottus: 30,
      unimarc: 30,
    });
    assert.equal(byChain.coope, undefined);
    const sample = db
      .prepare("SELECT url FROM url_queue WHERE chain_id = 'lider' ORDER BY product_id LIMIT 1")
      .get();
    assert.equal(
      sample.url,
      SEARCH_BY_CHAIN.lider + '7802810002099',
      'la URL de búsqueda debe derivar del GTIN/PLU, nunca del nombre'
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM offers WHERE status = 'pending'").get().n,
      180
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM offers WHERE price_captured_at IS NOT NULL').get().n,
      0
    );
    const plu = db
      .prepare(
        "SELECT gtin, identifier_value AS plu, identifier_kind FROM products WHERE id = 'palta-hass-jumbo-granel'"
      )
      .get();
    assert.equal(plu.gtin, null);
    assert.equal(plu.plu, '24851794');
    assert.equal(plu.identifier_kind, 'plu');
    const jumbo = db
      .prepare(
        "SELECT sku, source_url, captured_at FROM offers WHERE product_id = 'coca-original-15l' AND chain_id = 'jumbo'"
      )
      .get();
    assert.equal(jumbo.sku, '391');
    assert.ok(jumbo.source_url.startsWith('https://www.jumbo.cl/'));
    assert.equal(jumbo.captured_at, '2026-11-23');
  } finally {
    db.close();
  }
});

test('SQL rechaza GTIN inválido, precio no positivo, status desconocido y verified sin traza', () => {
  const db = seeded();
  try {
    const update = (table, column, value, where) =>
      db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${where}`).run(value);
    assert.throws(() => update('products', 'gtin', '24851794', "id = 'coca-original-15l'"));
    assert.throws(() =>
      update('offers', 'price', 0, "product_id = 'coca-original-15l' AND chain_id = 'lider'")
    );
    assert.throws(() =>
      update(
        'offers',
        'status',
        'desconocido',
        "product_id = 'coca-original-15l' AND chain_id = 'lider'"
      )
    );
    assert.throws(() =>
      update(
        'offers',
        'status',
        'verified',
        "product_id = 'coca-original-15l' AND chain_id = 'lider'"
      )
    );
  } finally {
    db.close();
  }
});

test('export es versionado, estable y coincide con el artefacto generado', () => {
  const first = seeded();
  const second = seeded();
  try {
    const a = readCatalog(first);
    const b = readCatalog(second);
    assert.equal(a.schemaVersion, CATALOG_SCHEMA_VERSION);
    assert.deepEqual(validateCatalogObject(a), []);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.products.length, 30);
    for (const product of a.products) {
      assert.deepEqual(
        product.offers.map((offer) => offer.chainId),
        CHAIN_ORDER
      );
    }
    const front = toFrontPayload(a);
    assert.equal(front.products.length, 30);
    assert.ok(renderDemoJs(a).includes('ARTEFACTO GENERADO'));
    const artifact = fs.readFileSync(new URL('../data/demo.js', import.meta.url), 'utf8');
    assert.equal(renderDemoJs(a), artifact);
    const ctx = { window: {} };
    vm.runInNewContext(artifact, ctx, { timeout: 1000 });
    assert.equal(JSON.stringify(ctx.window.UP_DEMO_DATA), JSON.stringify(readCatalogPayload()));
  } finally {
    first.close();
    second.close();
  }
});

test('buildCatalogDb reconstruye una BD válida desde la instantánea heredada', () => {
  const db = buildCatalogDb(':memory:');
  try {
    assert.deepEqual(validateDb(db).errors, []);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM offers').get().n, 180);
  } finally {
    db.close();
  }
});

const JUMBO_COCA = "product_id = 'coca-original-15l' AND chain_id = 'jumbo'";
const TEST_NOW = Date.parse('2026-11-24T12:00:00.000Z');

test('freshnessInfo distingue fresh, stale, missing, invalid y future', () => {
  assert.deepEqual(freshnessInfo(null, { now: () => TEST_NOW }), {
    state: 'missing',
    ageMs: null,
  });
  assert.equal(freshnessInfo('no-es-fecha', { now: () => TEST_NOW }).state, 'invalid');
  assert.equal(
    freshnessInfo(new Date(TEST_NOW + 1000).toISOString(), { now: () => TEST_NOW }).state,
    'future'
  );
  assert.equal(
    freshnessInfo(new Date(TEST_NOW - FRESHNESS_TTL_MS).toISOString(), {
      now: () => TEST_NOW,
    }).state,
    'fresh'
  );
  assert.equal(
    freshnessInfo(new Date(TEST_NOW - FRESHNESS_TTL_MS - 1).toISOString(), {
      now: () => TEST_NOW,
    }).state,
    'stale'
  );
});

test('los triggers exigen las dos parejas de procedencia para verified', () => {
  const db = seeded();
  try {
    const source = db
      .prepare(`SELECT source_url, captured_at FROM offers WHERE ${JUMBO_COCA}`)
      .get();
    assert.ok(source.source_url && source.captured_at);
    assert.throws(() =>
      db.prepare(`UPDATE offers SET status = 'verified' WHERE ${JUMBO_COCA}`).run()
    );
    db.prepare(`UPDATE offers SET price_source_url = ? WHERE ${JUMBO_COCA}`).run(source.source_url);
    assert.throws(() =>
      db.prepare(`UPDATE offers SET status = 'verified' WHERE ${JUMBO_COCA}`).run()
    );
    db.prepare(
      `UPDATE offers SET price_source = ?, price_attribution = ?, price_captured_at = ?, status = 'verified' WHERE ${JUMBO_COCA}`
    ).run('feed', 'Fuente: feed · prueba', new Date(TEST_NOW - 60_000).toISOString());
    assert.equal(
      db.prepare(`SELECT status FROM offers WHERE ${JUMBO_COCA}`).get().status,
      'verified'
    );
  } finally {
    db.close();
  }
});

test('applyFreshness degrada vencidos y checkFreshness detecta contradicciones', () => {
  const db = seeded();
  try {
    const source = db.prepare(`SELECT source_url FROM offers WHERE ${JUMBO_COCA}`).get();
    db.prepare(
      `UPDATE offers SET price_source_url = ?, price_source = ?, price_attribution = ?, price_captured_at = ?, status = 'verified' WHERE ${JUMBO_COCA}`
    ).run(
      source.source_url,
      'feed',
      'Fuente: feed · prueba',
      new Date(TEST_NOW - FRESHNESS_TTL_MS - 1).toISOString()
    );
    const before = checkFreshness(db, { now: () => TEST_NOW });
    assert.ok(before.errors.some((error) => error.includes('vencido')));
    assert.deepEqual(applyFreshness(db, { now: () => TEST_NOW }), { checked: 1, changed: 1 });
    assert.equal(db.prepare(`SELECT status FROM offers WHERE ${JUMBO_COCA}`).get().status, 'stale');
    assert.deepEqual(checkFreshness(db, { now: () => TEST_NOW }).errors, []);

    db.prepare(
      "UPDATE offers SET price_captured_at = ? WHERE product_id = 'coca-original-15l' AND chain_id = 'lider'"
    ).run(new Date(TEST_NOW - 60_000).toISOString());
    const pending = checkFreshness(db, { now: () => TEST_NOW });
    assert.ok(pending.errors.some((error) => error.includes('pending con precio capturado')));

    db.prepare(
      `UPDATE offers SET price_captured_at = ?, status = 'verified' WHERE ${JUMBO_COCA}`
    ).run(new Date(TEST_NOW + 60_000).toISOString());
    const future = checkFreshness(db, { now: () => TEST_NOW });
    assert.ok(future.errors.some((error) => error.includes('future')));
  } finally {
    db.close();
  }
});

test('validateDb detecta match_queue huérfano y huecos de coherencia', () => {
  const db = seeded();
  try {
    db.prepare(
      "UPDATE match_queue SET chain_id = 'desconocido' WHERE product_id = 'coca-original-15l' AND chain_id = 'lider'"
    ).run();
    const { errors } = validateDb(db);
    assert.ok(errors.some((error) => error.includes('match_queue huérfano (sin oferta)')));
    assert.ok(errors.some((error) => error.includes('match_queue ausente')));
    assert.ok(errors.some((error) => error.includes('match_queue cadena desconocida')));
  } finally {
    db.close();
  }
});

test('validateDb exige los triggers de procedencia de precio', () => {
  const db = seeded();
  try {
    db.exec('DROP TRIGGER offers_verified_provenance_update');
    const { errors } = validateDb(db);
    assert.ok(errors.includes('falta trigger offers_verified_provenance_update'));
  } finally {
    db.close();
  }
});

test('el export expone priceSourceUrl y la política de frescura, y rechaza verified vencido', () => {
  const db = seeded();
  try {
    const catalog = readCatalog(db);
    assert.equal(catalog.meta.freshness.ttlMs, FRESHNESS_TTL_MS);
    assert.equal(catalog.meta.freshness.sourceTtlMs.pricto, PRICTO_TTL_MS);
    assert.ok(catalog.meta.freshness.policy.includes('15 min'));
    assert.ok(catalog.meta.freshness.policy.includes('48 h'));
    for (const product of catalog.products) {
      for (const offer of product.offers) assert.equal(offer.priceSourceUrl, null);
    }
    assert.deepEqual(validateCatalogObject(catalog, { now: () => TEST_NOW }), []);

    const broken = JSON.parse(JSON.stringify(catalog));
    const offer = broken.products
      .find((p) => p.id === 'coca-original-15l')
      .offers.find((o) => o.chainId === 'jumbo');
    offer.status = 'verified';
    offer.priceCapturedAt = new Date(TEST_NOW - 60_000).toISOString();
    const missing = validateCatalogObject(broken, { now: () => TEST_NOW });
    assert.ok(missing.some((error) => error.includes('verified sin las dos parejas')));

    offer.priceSourceUrl = offer.sourceUrl;
    offer.priceCapturedAt = new Date(TEST_NOW - FRESHNESS_TTL_MS - 1).toISOString();
    const stale = validateCatalogObject(broken, { now: () => TEST_NOW });
    assert.ok(stale.some((error) => error.includes('verified con precio stale')));
  } finally {
    db.close();
  }
});

test('TTL por fuente: Pricto 48 h y fallback 15 min para fuentes desconocidas', () => {
  assert.equal(ttlForSource('pricto'), 48 * 60 * 60 * 1000);
  assert.equal(ttlForSource('feed'), FRESHNESS_TTL_MS);
  assert.equal(ttlForSource(null), FRESHNESS_TTL_MS);
  const fresh = new Date(TEST_NOW - 20 * 60 * 60 * 1000).toISOString();
  assert.equal(freshnessInfo(fresh, { now: () => TEST_NOW, source: 'pricto' }).state, 'fresh');
  assert.equal(freshnessInfo(fresh, { now: () => TEST_NOW, source: 'feed' }).state, 'stale');
});

test('applyFreshness no degrada un precio Pricto de 20 h pero sí uno de 49 h', () => {
  const db = seeded();
  try {
    const captured20h = new Date(TEST_NOW - 20 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `UPDATE offers SET price_source_url = ?, price_source = ?, price_attribution = ?, price_captured_at = ?, status = 'verified' WHERE ${JUMBO_COCA}`
    ).run(
      'https://pricto.dev/v1/products/prd_1/prices',
      'pricto',
      'Fuente: Pricto · prueba',
      captured20h
    );
    assert.deepEqual(checkFreshness(db, { now: () => TEST_NOW }).errors, []);
    assert.deepEqual(applyFreshness(db, { now: () => TEST_NOW }), { checked: 1, changed: 0 });

    const captured49h = new Date(TEST_NOW - 49 * 60 * 60 * 1000).toISOString();
    db.prepare(`UPDATE offers SET price_captured_at = ? WHERE ${JUMBO_COCA}`).run(captured49h);
    assert.deepEqual(applyFreshness(db, { now: () => TEST_NOW }), { checked: 1, changed: 1 });
  } finally {
    db.close();
  }
});

test('el export exige fuente y atribución, y respeta el TTL de Pricto', () => {
  const db = seeded();
  try {
    const catalog = readCatalog(db);
    const offer = catalog.products
      .find((p) => p.id === 'coca-original-15l')
      .offers.find((row) => row.chainId === 'jumbo');
    offer.status = 'verified';
    offer.priceSourceUrl = 'https://pricto.dev/v1/products/prd_1/prices';
    offer.priceCapturedAt = new Date(TEST_NOW - 20 * 60 * 60 * 1000).toISOString();
    const missing = validateCatalogObject(catalog, { now: () => TEST_NOW });
    assert.ok(missing.some((error) => error.includes('verified sin fuente ni atribución')));

    offer.priceSource = 'pricto';
    offer.priceAttribution = 'Fuente: Pricto · Jumbo · prueba';
    assert.deepEqual(validateCatalogObject(catalog, { now: () => TEST_NOW }), []);

    const front = toFrontPayload(catalog);
    const mapping = front.products.find((p) => p.id === 'coca-original-15l').skus.jumbo;
    assert.equal(mapping.priceSource, 'pricto');
    assert.equal(mapping.priceAttribution, 'Fuente: Pricto · Jumbo · prueba');
    assert.ok(mapping.priceRetailerUrl);
  } finally {
    db.close();
  }
});
