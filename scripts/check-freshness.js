#!/usr/bin/env node
/**
 * UP · Comprueba procedencia, frescura y coherencia de estados (Fase 3).
 * No modifica la BD: una oferta vencida es un error de datos, no un arreglo
 * silencioso. Sólo `applyFreshness` puede degradar `verified` → `stale`.
 * Uso: npm run check-freshness
 */
const { checkFreshness, FRESHNESS_TTL_MS, openCatalogDb } = require('./catalog-db');

const db = openCatalogDb({ readOnly: true });
let result;
try {
  result = checkFreshness(db);
} finally {
  db.close();
}

console.log('UP · Procedencia y frescura del catálogo SQLite');
console.log(`  TTL: ${FRESHNESS_TTL_MS} ms (15 min)`);
console.log(
  `  ofertas: ${result.summary.verified} verified · ${result.summary.pending} pending · ` +
    `${result.summary.stale} stale · ${result.summary.other} otras`
);

if (result.errors.length) {
  console.error(`\n${result.errors.length} error(es):`);
  for (const error of result.errors) console.error('  - ' + error);
  process.exit(1);
}
console.log('\nOK · ningún precio verificado vencido ni procedencia incompleta.');
