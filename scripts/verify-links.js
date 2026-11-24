#!/usr/bin/env node
/**
 * UP · Verificación controlada de enlaces del piloto Jumbo (Fase 4).
 * ---------------------------------------------------------------------------
 * Sólo lee url_queue de SQLite y escribe el RESULTADO DE LA FICHA allí.
 * Nunca cambia el status ni el priceCapturedAt de una oferta: que un enlace
 * exista NO confirma un precio. Un 403/429 o una regla de robots.txt pausa
 * la corrida y avisa, sin evasión ni reintentos agresivos.
 *
 * Uso:
 *   npm run verify-links -- --dry-run
 *   npm run verify-links -- --limit=3
 *   npm run verify-links
 */
const { createCircuitBreaker } = require('../lib/feed.js');
const { verifyLink } = require('../server.js');
const {
  conditionalHeaders,
  createDomainThrottle,
  createRobotsGuard,
  urlQueueStatus,
  backoffWithJitter,
} = require('../lib/link-policy.js');
const { applyMigrations, openCatalogDb, validateDb } = require('./catalog-db');

const PILOT_CHAIN = 'jumbo';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : null;
if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
  console.error('--limit debe ser un entero positivo');
  process.exit(1);
}

async function main() {
  const db = openCatalogDb();
  const cache = new Map();
  const breaker = createCircuitBreaker({ threshold: 3, cooldownMs: 60_000 });
  const robotsGuard = createRobotsGuard();
  const throttle = createDomainThrottle();
  const summary = { checked: 0, verified: 0, notModified: 0, paused: 0, broken: 0, unavailable: 0 };

  try {
    applyMigrations(db);
    const { errors } = validateDb(db);
    if (errors.length) throw new Error(errors.join('; '));

    let rows = db
      .prepare(
        `SELECT u.id, u.product_id, u.url, u.etag, u.last_modified, u.status,
              o.status AS offer_status
         FROM url_queue u
         JOIN offers o ON o.product_id = u.product_id AND o.chain_id = u.chain_id
        WHERE u.chain_id = ?
        ORDER BY u.product_id`
      )
      .all(PILOT_CHAIN);
    if (limit !== null) rows = rows.slice(0, limit);

    const update = db.prepare(
      `UPDATE url_queue
        SET status = ?, http_status = ?, checked_at = ?, last_error = ?,
            etag = ?, last_modified = ?, final_url = ?, robots_status = ?, robots_checked_at = ?,
            updated_at = ?
      WHERE id = ?`
    );

    for (const row of rows) {
      const result = await verifyLink(row.url, {
        fetch,
        cache,
        breaker,
        robotsGuard,
        throttle,
        conditional: conditionalHeaders(row.etag, row.last_modified),
        etag: row.etag,
        lastModified: row.last_modified,
      });
      const status = urlQueueStatus(result);
      summary.checked += 1;
      if (result.notModified) summary.notModified += 1;
      if (status === 'verified') summary.verified += 1;
      else if (status === 'paused') summary.paused += 1;
      else if (status === 'broken') summary.broken += 1;
      else summary.unavailable += 1;

      // Un 403/429 en robots.txt también abre el circuito: se pausa, no se evade.
      if (result.robotsPaused && [403, 429].includes(result.status)) {
        const failures = breaker.snapshot()[PILOT_CHAIN]?.failures || 0;
        const retryMs = Number.isFinite(result.retryAfterMs)
          ? result.retryAfterMs
          : backoffWithJitter(failures);
        breaker.recordFailure(PILOT_CHAIN, retryMs);
      }
      if (result.paused) {
        console.warn(`[UP] PAUSA ${row.product_id}: ${result.error}`);
      }

      if (!dryRun) {
        update.run(
          status,
          result.status || null,
          result.checkedAt,
          result.ok ? null : result.error,
          result.etag || row.etag,
          result.lastModified || row.last_modified,
          result.finalUrl || null,
          result.robotsStatus || null,
          result.robotsCheckedAt || null,
          result.checkedAt,
          row.id
        );
      }
    }
  } finally {
    db.close();
  }

  console.log('UP · Verificación de enlaces · cadena piloto: ' + PILOT_CHAIN);
  console.log('  modo      : ' + (dryRun ? 'dry-run (sin escribir)' : 'escritura en url_queue'));
  console.log(
    `  revisadas ${summary.checked} · verificadas ${summary.verified} · 304 ${summary.notModified} · ` +
      `pausadas ${summary.paused} · rotas ${summary.broken} · no disponibles ${summary.unavailable}`
  );
  console.log('  ofertas modificadas: 0 (los precios siguen pending)');
  if (summary.paused) {
    console.warn('[UP] Cadena pausada: se requiere renegociar acceso antes de reintentar.');
    process.exitCode = 1;
  } else if (summary.broken || summary.unavailable) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
