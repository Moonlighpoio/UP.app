import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  CATALOG_SCHEMA_VERSION,
  CHAIN_ORDER,
  buildCatalogDb,
  createCatalogDb,
  ean13CheckDigit,
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

test('migraciones crean tablas, índices y registra 001_init.sql', () => {
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
    ]) {
      assert.ok(objects.includes(name), name);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 1);
  } finally {
    db.close();
  }
});

test('siembra 30 productos, 180 ofertas pendientes y colas sin inventar datos', () => {
  const db = seeded();
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products').get().n, 30);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM offers').get().n, 180);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM match_queue').get().n, 153);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM url_queue').get().n, 30);
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
