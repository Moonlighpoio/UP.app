#!/usr/bin/env node
/**
 * UP · Validador de la fuente de verdad y sus artefactos (Fase 2).
 * Uso: npm run validate-catalog
 *
 * Comprueba esquema, migraciones, índices, EAN-13, precios, estados,
 * coincidencia de data/catalog.json y del data/demo.js generado.
 */
const fs = require('node:fs');
const vm = require('node:vm');
const {
  CATALOG_JSON_FILE,
  DEMO_JS_FILE,
  OFFER_STATUSES,
  openCatalogDb,
  toFrontPayload,
  validateDb,
  validateCatalogObject,
} = require('./catalog-db');

const errors = [];
const db = openCatalogDb({ readOnly: true });
let catalog = null;
try {
  const result = validateDb(db);
  catalog = result.catalog;
  errors.push(...result.errors);
} finally {
  db.close();
}

if (catalog) {
  const counts = catalog.meta.counts;
  const expected = {
    products: 30,
    offers: 180,
    matchQueue: 153,
    urlQueue: 30,
    chains: 6,
    stores: 10,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (counts[key] !== value) errors.push(`${key}: esperado ${value}, got ${counts[key]}`);
  }
  const statuses = new Set(catalog.products.flatMap((p) => p.offers.map((o) => o.status)));
  for (const status of statuses) {
    if (!OFFER_STATUSES.includes(status)) errors.push(`status inesperado ${status}`);
  }
  if (statuses.size !== 1 || !statuses.has('pending')) {
    errors.push(`todas las ofertas heredadas deben ser pending (got ${[...statuses].join(',')})`);
  }
  const gtins = catalog.products.filter((p) => p.identifier.kind === 'gtin').length;
  const plus = catalog.products.filter((p) => p.identifier.kind === 'plu').length;
  if (gtins !== 27 || plus !== 3) {
    errors.push(`identificadores: esperados 27 GTIN + 3 PLU (got ${gtins} + ${plus})`);
  }

  if (!fs.existsSync(CATALOG_JSON_FILE)) {
    errors.push('falta data/catalog.json');
  } else {
    const exported = JSON.parse(fs.readFileSync(CATALOG_JSON_FILE, 'utf8'));
    if (JSON.stringify(exported) !== JSON.stringify(catalog)) {
      errors.push('data/catalog.json no coincide con la BD');
    }
    errors.push(...validateCatalogObject(exported).map((e) => 'catalog.json: ' + e));
  }

  if (!fs.existsSync(DEMO_JS_FILE)) {
    errors.push('falta data/demo.js');
  } else {
    const ctx = { window: {} };
    vm.runInNewContext(fs.readFileSync(DEMO_JS_FILE, 'utf8'), ctx, { timeout: 1000 });
    const expectedFront = toFrontPayload(catalog);
    if (JSON.stringify(ctx.window.UP_DEMO_DATA) !== JSON.stringify(expectedFront)) {
      errors.push('data/demo.js no coincide con el catálogo versionado');
    }
  }
}

console.log('UP · Validación del catálogo SQLite');
console.log('  BD        : data/catalog.sqlite');
console.log('  exportado : data/catalog.json');
console.log('  artefacto : data/demo.js');
if (catalog) {
  const c = catalog.meta.counts;
  console.log(
    `  productos ${c.products} · ofertas ${c.offers} · match_queue ${c.matchQueue} · url_queue ${c.urlQueue}`
  );
}

if (errors.length) {
  console.error(`\n${errors.length} error(es):`);
  for (const error of errors) console.error('  - ' + error);
  process.exit(1);
}
console.log('\nOK · esquema, índices, EAN-13, estados y artefactos consistentes.');
