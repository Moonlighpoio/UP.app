#!/usr/bin/env node
/**
 * UP · Reconstruye data/catalog.sqlite desde db/legacy/ y regenera artefactos.
 * Uso: npm run build-catalog
 */
const { buildCatalogDb, exportArtifacts, validateDb } = require('./catalog-db');

const db = buildCatalogDb();
try {
  const { errors, catalog } = validateDb(db);
  if (errors.length) throw new Error(errors.join('; '));
  const written = exportArtifacts(catalog);
  console.log('UP · Catálogo reconstruido desde la instantánea heredada.');
  console.log('  schemaVersion : ' + catalog.schemaVersion);
  console.log('  BD            : data/catalog.sqlite');
  console.log('  artefactos    : ' + written.catalogJson + ', ' + written.demoJs);
  const counts = catalog.meta.counts;
  console.log(
    `  productos ${counts.products} · ofertas ${counts.offers} · match_queue ${counts.matchQueue} · url_queue ${counts.urlQueue}`
  );
} finally {
  db.close();
}
