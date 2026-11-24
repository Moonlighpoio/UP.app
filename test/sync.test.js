import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCatalogDb, seedCatalog, validateDb } = require('../scripts/catalog-db.js');
const { COVERED_CHAINS, runSync, selectOffers } = require('../scripts/sync.js');

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function seeded() {
  const db = createCatalogDb(':memory:');
  seedCatalog(db);
  return db;
}

function firstOffer(db) {
  return db
    .prepare(
      `SELECT product_id, chain_id, gtin, source_url FROM offers
       WHERE chain_id = 'jumbo' AND gtin IS NOT NULL
       ORDER BY product_id, chain_id LIMIT 1`
    )
    .get();
}

function offerFor(row) {
  return {
    chainId: row.chain_id,
    price: 1990,
    sourceUrl: 'https://www.jumbo.cl/productos/verificado',
    capturedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    priceSource: 'pricto',
    priceSourceUrl: 'https://pricto.dev/v1/products/prd_1/prices',
    priceAttribution: 'Fuente: Pricto · Jumbo · página pública · ofr_1',
    offerId: 'ofr_1',
    retailerName: 'Jumbo',
  };
}

function fakeClient(row, { fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async listProducts(gtins) {
      calls.push({ method: 'listProducts', gtins });
      return { ok: true, products: [], byGtin: new Map([[row.gtin, 'prd_1']]) };
    },
    async getPrices(productId, chainId) {
      calls.push({ method: 'getPrices', productId, chainId });
      if (fail) return { ok: false, reason: 'Pricto pausó el conector (HTTP 429)' };
      return { ok: true, offer: offerFor(row) };
    },
    snapshot() {
      return { creditsCharged: calls.length, breaker: {} };
    },
  };
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('sin PRICTO_API_KEY real la CLI falla antes de abrir la BD', () => {
  const dbFile = new URL('../data/catalog.sqlite', import.meta.url);
  const before = sha256(dbFile);
  const result = spawnSync(process.execPath, ['scripts/sync.js'], {
    cwd: ROOT,
    env: { ...process.env, PRICTO_API_KEY: '' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PRICTO_API_KEY/);
  assert.match(result.stderr, /No se escribió nada/);
  assert.equal(sha256(dbFile), before);
});

test('--chain rechaza cadenas sin cobertura Pricto antes de cualquier petición', () => {
  const db = seeded();
  try {
    assert.throws(() => selectOffers(db, { chain: 'lider' }), /sin cobertura/);
    assert.deepEqual(COVERED_CHAINS.sort(), ['jumbo', 'santaisabel', 'unimarc']);
  } finally {
    db.close();
  }
});

test('--dry-run cotiza créditos pero no pide precios ni escribe BD/artefactos', async () => {
  const db = seeded();
  const row = firstOffer(db);
  const client = fakeClient(row);
  let artifactWrites = 0;
  try {
    const report = await runSync({
      db,
      client,
      chain: 'jumbo',
      limit: 1,
      dryRun: true,
      writeArtifacts: () => artifactWrites++,
      stdout: () => {},
    });
    assert.equal(report.ok, true);
    assert.equal(report.written, 0);
    assert.equal(report.candidates.length, 0);
    assert.deepEqual(report.quote, {
      listingCredits: 1,
      estimatedPriceCredits: 1,
      total: 2,
    });
    assert.deepEqual(
      client.calls.map((call) => call.method),
      ['listProducts']
    );
    assert.equal(artifactWrites, 0);
    assert.equal(
      db
        .prepare('SELECT status FROM offers WHERE product_id = ? AND chain_id = ?')
        .get(row.product_id, row.chain_id).status,
      'pending'
    );
  } finally {
    db.close();
  }
});

test('la corrida real escribe verified con procedencia completa y regenera artefactos', async () => {
  const db = seeded();
  const row = firstOffer(db);
  const client = fakeClient(row);
  let artifactWrites = 0;
  try {
    const report = await runSync({
      db,
      client,
      chain: 'jumbo',
      limit: 1,
      writeArtifacts: () => artifactWrites++,
      stdout: () => {},
    });
    assert.equal(report.ok, true);
    assert.equal(report.written, 1);
    assert.equal(artifactWrites, 1);
    const offer = db
      .prepare('SELECT * FROM offers WHERE product_id = ? AND chain_id = ?')
      .get(row.product_id, row.chain_id);
    assert.equal(offer.status, 'verified');
    assert.equal(offer.price, 1990);
    assert.equal(offer.price_source, 'pricto');
    assert.equal(offer.price_attribution, 'Fuente: Pricto · Jumbo · página pública · ofr_1');
    assert.equal(offer.price_source_url, 'https://pricto.dev/v1/products/prd_1/prices');
    assert.equal(offer.source_url, row.source_url, 'la ficha canónica existente no se sobrescribe');
    assert.ok(offer.price_captured_at);
    assert.deepEqual(validateDb(db).errors, []);
  } finally {
    db.close();
  }
});

test('sin ofertas aceptables no se escribe nada (fail closed)', async () => {
  const db = seeded();
  const row = firstOffer(db);
  const client = fakeClient(row, { fail: true });
  let artifactWrites = 0;
  try {
    const report = await runSync({
      db,
      client,
      chain: 'jumbo',
      limit: 1,
      writeArtifacts: () => artifactWrites++,
      stdout: () => {},
    });
    assert.equal(report.ok, true);
    assert.equal(report.written, 0);
    assert.equal(report.failures.length, 1);
    assert.equal(artifactWrites, 0);
    assert.equal(
      db
        .prepare('SELECT status FROM offers WHERE product_id = ? AND chain_id = ?')
        .get(row.product_id, row.chain_id).status,
      'pending'
    );
  } finally {
    db.close();
  }
});
