#!/usr/bin/env node
/**
 * UP · Verificación controlada de enlaces (Fase 4: Jumbo; Fase 5: resto).
 * ---------------------------------------------------------------------------
 * Sólo lee url_queue de SQLite y escribe el RESULTADO DEL ENLACE allí.
 * Nunca cambia el status ni el priceCapturedAt de una oferta: que un enlace
 * responda NO confirma el producto ni el precio. Un 403/429, robots no
 * utilizable o una cola de espera PAUSAN la cadena y avisan, sin evasión.
 *
 * Uso:
 *   npm run verify-links -- --dry-run
 *   npm run verify-links -- --limit=3
 *   npm run verify-links -- --chain=lider
 *   npm run verify-links -- --all --dry-run
 *   npm run verify-links -- --all
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
const { applyMigrations, CHAIN_ORDER, openCatalogDb, validateDb } = require('./catalog-db');

const DEFAULT_CHAIN = 'jumbo';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const allChains = args.includes('--all');
const chainArg = args.find((arg) => arg.startsWith('--chain='));
const chainId = chainArg ? chainArg.slice('--chain='.length) : DEFAULT_CHAIN;
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : null;

if (allChains && chainArg) {
  console.error('Usa --all o --chain=<id>, no ambos');
  process.exit(1);
}
if (!allChains && !CHAIN_ORDER.includes(chainId)) {
  console.error(`Cadena desconocida: ${chainId}`);
  process.exit(1);
}
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
  const summary = {};

  try {
    applyMigrations(db);
    const { errors } = validateDb(db);
    if (errors.length) throw new Error(errors.join('; '));

    const allRows = db
      .prepare(
        `SELECT u.id, u.product_id, u.chain_id, u.url, u.etag, u.last_modified, u.status,
                o.status AS offer_status
           FROM url_queue u
           JOIN offers o ON o.product_id = u.product_id AND o.chain_id = u.chain_id
          ORDER BY u.chain_id, u.product_id`
      )
      .all();
    const available = new Set(allRows.map((row) => row.chain_id));
    const chains = allChains ? CHAIN_ORDER.filter((id) => available.has(id)) : [chainId];
    if (!chains.length || (!allChains && !available.has(chainId))) {
      throw new Error(
        `Sin URLs verificables para ${allChains ? 'ninguna cadena' : chainId}; no se inventan URLs`
      );
    }

    const update = db.prepare(
      `UPDATE url_queue
          SET status = ?, http_status = ?, checked_at = ?, last_error = ?,
              etag = ?, last_modified = ?, final_url = ?, robots_status = ?, robots_checked_at = ?,
              updated_at = ?
        WHERE id = ?`
    );

    for (const currentChain of chains) {
      summary[currentChain] = {
        checked: 0,
        verified: 0,
        notModified: 0,
        paused: 0,
        broken: 0,
        unavailable: 0,
      };
      const rows = allRows.filter((row) => row.chain_id === currentChain);
      const selected = limit === null ? rows : rows.slice(0, limit);

      for (const row of selected) {
        const result = await verifyLink(row.url, {
          fetch,
          cache,
          breaker,
          robotsGuard,
          throttle,
          chain: currentChain,
          conditional: conditionalHeaders(row.etag, row.last_modified),
          etag: row.etag,
          lastModified: row.last_modified,
        });
        const status = urlQueueStatus(result);
        const tally = summary[currentChain];
        tally.checked += 1;
        if (result.notModified) tally.notModified += 1;
        if (status === 'verified') tally.verified += 1;
        else if (status === 'paused') tally.paused += 1;
        else if (status === 'broken') tally.broken += 1;
        else tally.unavailable += 1;

        // Un 403/429 en robots.txt también abre el circuito: se pausa, no se evade.
        if (result.robotsPaused && [403, 429].includes(result.status)) {
          const failures = breaker.snapshot()[currentChain]?.failures || 0;
          const retryMs = Number.isFinite(result.retryAfterMs)
            ? result.retryAfterMs
            : backoffWithJitter(failures);
          breaker.recordFailure(currentChain, retryMs);
        }
        if (result.paused) {
          console.warn(`[UP] PAUSA ${currentChain}/${row.product_id}: ${result.error}`);
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
    }
  } finally {
    db.close();
  }

  console.log(
    'UP · Verificación de enlaces · ' + (allChains ? 'todas las cadenas con patrón' : chainId)
  );
  console.log('  modo      : ' + (dryRun ? 'dry-run (sin escribir)' : 'escritura en url_queue'));
  let problems = 0;
  for (const [currentChain, tally] of Object.entries(summary)) {
    console.log(
      `  ${currentChain.padEnd(11)} revisadas ${tally.checked} · verificadas ${tally.verified} · ` +
        `304 ${tally.notModified} · pausadas ${tally.paused} · rotas ${tally.broken} · ` +
        `no disponibles ${tally.unavailable}`
    );
    problems += tally.paused + tally.broken + tally.unavailable;
  }
  console.log('  ofertas modificadas: 0 (los precios siguen pending)');
  if (problems) {
    console.warn('[UP] Hay cadenas pausadas o no disponibles: no se reintentan evasiones.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
