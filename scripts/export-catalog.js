#!/usr/bin/env node
/**
 * UP · Regenera data/catalog.json y data/demo.js desde la BD versionada.
 * No modifica la BD; falla si la BD no pasa validación.
 * Uso: npm run export-catalog
 */
const { openCatalogDb, exportArtifacts, validateDb } = require('./catalog-db');

const db = openCatalogDb({ readOnly: true });
try {
  const { errors, catalog } = validateDb(db);
  if (errors.length) throw new Error(errors.join('; '));
  const written = exportArtifacts(catalog);
  console.log('UP · Artefactos exportados desde data/catalog.sqlite:');
  console.log('  ' + written.catalogJson);
  console.log('  ' + written.demoJs);
  console.log('  ' + written.productImages);
} finally {
  db.close();
}
