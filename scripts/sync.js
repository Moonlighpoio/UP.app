#!/usr/bin/env node
/**
 * UP · Sincroniza precios verificados desde Pricto a SQLite (Fase 6).
 * ---------------------------------------------------------------------------
 * Uso:
 *   npm run sync -- --dry-run                 # cotiza créditos, NO escribe
 *   npm run sync -- --chain=jumbo --limit=1   # alcance acotado
 *   npm run sync                              # cadenas cubiertas
 *
 * PRICTO_API_KEY (sk_live_ de cuenta propia) se exporta localmente; nunca se
 * commitea ni se muestra. Sin key real el comando falla sin tocar la BD ni los
 * artefactos. Sólo se marcan `verified` las ofertas que pasan todas las
 * validaciones del adapter; el resto queda `pending` y se reporta.
 */
const { applyMigrations, exportArtifacts, openCatalogDb, validateDb } = require('./catalog-db');
const { RETAILER_BY_CHAIN, createPrictoClient, isLiveKey } = require('../lib/pricto');

const COVERED_CHAINS = Object.keys(RETAILER_BY_CHAIN);
const USAGE = [
  'Uso: npm run sync -- [opciones]',
  '  --dry-run             cotiza créditos sin pedir precios ni escribir nada',
  '  --chain=<id>          jumbo | santaisabel | unimarc (default: las tres)',
  '  --limit=N             máximo de productos a procesar',
  '  --max-credits=N       tope de créditos a gastar (default: 100)',
].join('\n');

function parseArgs(argv) {
  const opts = { dryRun: false, chain: null, limit: null, maxCredits: 100, help: false };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg.startsWith('--chain=')) opts.chain = arg.slice('--chain='.length);
    else if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));
      if (!Number.isInteger(value) || value <= 0) throw new Error(`--limit inválido: ${arg}`);
      opts.limit = value;
    } else if (arg.startsWith('--max-credits=')) {
      const value = Number(arg.slice('--max-credits='.length));
      if (!Number.isInteger(value) || value < 0) throw new Error(`--max-credits inválido: ${arg}`);
      opts.maxCredits = value;
    } else {
      throw new Error(`argumento desconocido: ${arg}`);
    }
  }
  return opts;
}

function selectOffers(db, { chain = null, limit = null } = {}) {
  const chains = chain ? [chain] : COVERED_CHAINS;
  for (const id of chains) {
    if (!COVERED_CHAINS.includes(id)) {
      throw new Error(`cadena ${id} sin cobertura verificada en Pricto; nada que sincronizar`);
    }
  }
  const placeholders = chains.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT product_id, chain_id, gtin FROM offers
       WHERE chain_id IN (${placeholders}) AND gtin IS NOT NULL
       ORDER BY product_id, chain_id`
    )
    .all(...chains);
  const byProduct = new Map();
  for (const row of rows) {
    if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, []);
    byProduct.get(row.product_id).push(row);
  }
  let products = [...byProduct.entries()];
  if (limit != null) products = products.slice(0, limit);
  return {
    chains,
    products,
    offers: products.reduce((count, [, offers]) => count + offers.length, 0),
  };
}

/**
 * Orquestación pura (db + client inyectados). No lee variables de entorno:
 * la credencial la crea la CLI y vive sólo en el cliente.
 */
async function runSync({
  db,
  client,
  chain = null,
  limit = null,
  dryRun = false,
  now = Date.now,
  writeArtifacts = exportArtifacts,
  stdout = console.log,
} = {}) {
  const { chains, products, offers } = selectOffers(db, { chain, limit });
  const gtins = [
    ...new Set(products.flatMap(([, rows]) => rows.map((row) => row.gtin)).filter(Boolean)),
  ];
  stdout(
    `UP · sync Pricto: ${products.length} productos · ${offers} ofertas · ` +
      `${chains.join(', ')} · ${dryRun ? 'DRY RUN (sin escritura)' : 'escritura'}`
  );

  if (dryRun) {
    // Pricto devuelve `data: null` con dry_run=true: se cotiza la búsqueda y se
    // estiman los precios por su tarifa documentada, sin pedir precios ni escribir.
    const quoted = await client.listProducts(gtins, { dryRun: true });
    if (!quoted.ok) {
      return { ok: false, reason: quoted.reason, snapshot: client.snapshot(), written: 0 };
    }
    const quote = {
      listingCredits: Number(quoted.quote?.credits_charged) || Math.ceil(gtins.length / 20),
      estimatedPriceCredits: offers,
      total: (Number(quoted.quote?.credits_charged) || Math.ceil(gtins.length / 20)) + offers,
    };
    stdout(
      `  cotización estimada: ${quote.total} créditos ` +
        `(${quote.listingCredits} búsqueda + ${quote.estimatedPriceCredits} precios)`
    );
    stdout('DRY RUN · BD y artefactos intactos; ejecuta sin --dry-run para sincronizar.');
    return {
      ok: true,
      dryRun: true,
      quote,
      candidates: [],
      failures: [],
      snapshot: client.snapshot(),
      written: 0,
    };
  }

  const listed = await client.listProducts(gtins);
  if (!listed.ok) {
    return { ok: false, reason: listed.reason, snapshot: client.snapshot(), written: 0 };
  }

  const candidates = [];
  const failures = [];
  for (const [productId, rows] of products) {
    for (const row of rows) {
      const remoteId = listed.byGtin.get(row.gtin);
      if (!remoteId) {
        failures.push({ productId, chainId: row.chainId, reason: 'GTIN sin producto en Pricto' });
        continue;
      }
      const result = await client.getPrices(remoteId, row.chainId);
      if (!result.ok) {
        failures.push({ productId, chainId: row.chainId, reason: result.reason });
        continue;
      }
      candidates.push({ ...result.offer, productId, gtin: row.gtin });
    }
  }

  const snapshot = client.snapshot();
  for (const failure of failures) {
    stdout(`  · omitido ${failure.productId}/${failure.chainId}: ${failure.reason}`);
  }
  stdout(
    `  ofertas aceptadas: ${candidates.length}/${offers} · créditos: ` +
      `${snapshot.creditsCharged ?? 0} · breakers: ${JSON.stringify(snapshot.breaker)}`
  );

  if (!candidates.length) {
    stdout('Sin ofertas verificables: BD y artefactos intactos (fail closed).');
    return { ok: true, candidates, failures, snapshot, written: 0 };
  }

  const stamp = new Date(now()).toISOString();
  const update = db.prepare(`
    UPDATE offers
       SET price = @price,
           status = 'verified',
           source_url = COALESCE(source_url, @sourceUrl),
           captured_at = @capturedAt,
           price_source_url = @priceSourceUrl,
           price_captured_at = @capturedAt,
           price_source = @priceSource,
           price_attribution = @priceAttribution,
           note = @note,
           updated_at = @updatedAt
     WHERE product_id = @productId AND chain_id = @chainId
  `);
  let written = 0;
  let catalog = null;
  db.exec('BEGIN');
  try {
    for (const offer of candidates) {
      const info = update.run({
        price: offer.price,
        sourceUrl: offer.sourceUrl,
        capturedAt: offer.capturedAt,
        priceSourceUrl: offer.priceSourceUrl,
        priceSource: offer.priceSource,
        priceAttribution: offer.priceAttribution,
        note: `Precio verificado por ${offer.retailerName} vía Pricto · ${offer.offerId}`,
        updatedAt: stamp,
        productId: offer.productId,
        chainId: offer.chainId,
      });
      written += info.changes;
    }
    const validation = validateDb(db, { now });
    if (validation.errors.length) throw new Error(validation.errors.join('; '));
    catalog = validation.catalog;
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  if (catalog) {
    const files = writeArtifacts(catalog);
    stdout(
      `  ${written} ofertas verificadas · artefactos: ${files.catalogJson}, ${files.demoJs}, ${files.productImages}`
    );
  }
  return { ok: true, dryRun: false, candidates, failures, snapshot, written };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  const apiKey = process.env.PRICTO_API_KEY;
  if (!isLiveKey(apiKey)) {
    console.error(
      'UP · PRICTO_API_KEY ausente o no válida. Crea una cuenta en https://pricto.dev/registro ' +
        'y exporta localmente tu key sk_live_ antes de sincronizar. La sandbox está prohibida ' +
        'como precio real. No se escribió nada.'
    );
    process.exitCode = 1;
    return;
  }

  const db = openCatalogDb();
  try {
    applyMigrations(db);
    const client = createPrictoClient({ apiKey, maxCredits: opts.maxCredits });
    const report = await runSync({ db, client, ...opts });
    if (!report.ok) {
      console.error('UP · sync abortado: ' + report.reason);
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('UP · sync abortado: ' + err.message);
    process.exitCode = 1;
  });
}

module.exports = { COVERED_CHAINS, USAGE, parseArgs, selectOffers, runSync };
