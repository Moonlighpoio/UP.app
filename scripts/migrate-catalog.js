#!/usr/bin/env node
/**
 * UP · Aplica migraciones pendientes a data/catalog.sqlite (Fase 3).
 * No reescribe la historia de la BD: sólo ejecuta SQL versionado y, si todo
 * valida, regenera los artefactos derivados.
 * Uso: npm run migrate-catalog
 */
const { applyMigrations, exportArtifacts, openCatalogDb, validateDb } = require('./catalog-db');

const db = openCatalogDb();
try {
  const applied = applyMigrations(db);
  const { errors, catalog } = validateDb(db);
  if (errors.length) throw new Error(errors.join('; '));
  const written = exportArtifacts(catalog);
  console.log('UP · Migraciones aplicadas: ' + applied.join(', '));
  console.log('  BD        : data/catalog.sqlite');
  console.log(
    '  artefactos: ' + [written.catalogJson, written.demoJs, written.productImages].join(', ')
  );
} finally {
  db.close();
}
