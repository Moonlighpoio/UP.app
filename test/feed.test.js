import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  CHAIN_IDS,
  PAUSE_STATUSES,
  FEED_TTL_MS,
  FEED_SCHEMA_VERSION,
  classifyStatus,
  parseRetryAfterMs,
  createCircuitBreaker,
  createFeedCache,
  normalizeFeed,
  chainForUrl,
  getPrices,
  verifyLink,
  resetIntegrationState,
} = require('../server.js');

const NOW = '2026-11-24T12:00:00.000Z';
const T = Date.parse(NOW);

function feedFixture(overrides = {}) {
  return {
    meta: {
      mode: 'live',
      generatedAt: NOW,
      source: 'feed de prueba autorizado',
      currency: 'CLP',
      locale: 'es-CL',
    },
    chains: { jumbo: { name: 'Jumbo' } },
    stores: [],
    products: [
      Object.assign(
        {
          id: 'p1',
          name: 'Producto de prueba',
          detail: 'Botella 1 L',
          category: 'Bebidas y Licores',
          offers: [
            {
              chainId: 'jumbo',
              price: 1990,
              capturedAt: NOW,
              sku: 'ABC-1',
              gtin: '1234567890123',
              url: 'https://www.jumbo.cl/p/abc-1',
              exact: true,
            },
          ],
        },
        overrides
      ),
    ],
  };
}

function demoFixture() {
  return {
    meta: { mode: 'demo', generatedAt: '2026-01-01' },
    chains: {},
    stores: [],
    products: [],
  };
}

function depsFor({
  now = () => T,
  feed = feedFixture(),
  fetchImpl,
  breaker,
  cache,
  upstream = 'https://feed.test/precios',
  existsSync = () => false,
  readFileSync,
  readDemo = demoFixture,
} = {}) {
  return {
    now,
    upstream,
    fetch: fetchImpl || (async () => ({ ok: true, status: 200, json: async () => feed })),
    existsSync,
    readFileSync,
    readDemo,
    cache: cache || createFeedCache({ ttlMs: FEED_TTL_MS, now }),
    breaker: breaker || createCircuitBreaker({ threshold: 3, cooldownMs: 60_000, now }),
    linkBreaker: createCircuitBreaker({ threshold: 3, cooldownMs: 60_000, now }),
  };
}

let serverBase;
let startedHere = false;

before(async () => {
  resetIntegrationState();
  // El servidor shared se usa solo para /api/feed-status (sin red externa).
  const { server } = require('../server.js');
  if (!server.listening) {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    startedHere = true;
  }
  serverBase = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  resetIntegrationState();
  if (startedHere) {
    const { server } = require('../server.js');
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('classifyStatus separa pausa, éxito y error', () => {
  assert.equal(classifyStatus(403), 'pause');
  assert.equal(classifyStatus(429), 'pause');
  assert.equal(classifyStatus(200), 'ok');
  assert.equal(classifyStatus(204), 'ok');
  assert.equal(classifyStatus(500), 'error');
  assert.deepEqual([...PAUSE_STATUSES], [403, 429]);
});

test('parseRetryAfterMs entiende segundos, fecha HTTP y valores inválidos', () => {
  assert.equal(
    parseRetryAfterMs('120', () => T),
    120_000
  );
  assert.equal(
    parseRetryAfterMs(new Date(T + 30_000).toUTCString(), () => T),
    30_000
  );
  assert.equal(
    parseRetryAfterMs('basura', () => T),
    null
  );
  assert.equal(
    parseRetryAfterMs(null, () => T),
    null
  );
  assert.equal(
    parseRetryAfterMs('99999', () => T),
    300_000
  );
});

test('createCircuitBreaker: closed → open → half-open → closed', () => {
  let t = T;
  const breaker = createCircuitBreaker({ threshold: 3, cooldownMs: 60_000, now: () => t });
  assert.equal(breaker.allow('jumbo'), true);
  breaker.recordFailure('jumbo');
  breaker.recordFailure('jumbo');
  assert.equal(breaker.allow('jumbo'), true);
  breaker.recordFailure('jumbo', 30_000);
  assert.equal(breaker.allow('jumbo'), false);
  assert.equal(breaker.snapshot().jumbo.state, 'open');
  assert.equal(breaker.snapshot().jumbo.nextRetryInMs, 30_000);

  t += 30_001;
  assert.equal(breaker.allow('jumbo'), true);
  assert.equal(breaker.snapshot().jumbo.state, 'half-open');
  breaker.recordFailure('jumbo');
  assert.equal(breaker.snapshot().jumbo.state, 'open');

  t += 60_001;
  breaker.recordSuccess('jumbo');
  assert.equal(breaker.snapshot().jumbo.state, 'closed');
  assert.equal(breaker.snapshot().jumbo.failures, 0);
  breaker.reset();
  assert.deepEqual(breaker.snapshot(), {});
});

test('createFeedCache aplica TTL y marca entradas vencidas como stale', () => {
  let t = T;
  const cache = createFeedCache({ ttlMs: 1000, now: () => t });
  assert.equal(cache.get('x'), null);
  cache.set('x', { ok: true }, { validOffers: 1 });
  assert.equal(cache.get('x').stale, false);
  assert.equal(cache.get('x').ageMs, 0);
  t += 1001;
  assert.equal(cache.get('x').stale, true);
  assert.equal(cache.get('x').report.validOffers, 1);
  assert.ok(cache.snapshot().x.expiresAt.endsWith('Z'));
  cache.reset();
  assert.equal(cache.get('x'), null);
});

test('normalizeFeed convierte offers en prices/skus para el front', () => {
  const { data, report } = normalizeFeed(feedFixture(), { now: () => T });
  assert.equal(data.meta.mode, 'live');
  assert.equal(data.products[0].prices.jumbo, 1990);
  assert.equal(data.products[0].skus.jumbo.sku, 'ABC-1');
  assert.equal(data.products[0].skus.jumbo.url, 'https://www.jumbo.cl/p/abc-1');
  assert.equal(data.products[0].skus.jumbo.exact, true);
  assert.equal(data.products[0].capturedAt, NOW);
  assert.equal(report.validOffers, 1);
  assert.equal(report.byChain.jumbo, 1);
  assert.equal(report.oldestCapturedAt, NOW);
  assert.equal(report.warnings.length, 0);
});

test('normalizeFeed acepta el formato legado prices + skus', () => {
  const legacy = feedFixture();
  const product = legacy.products[0];
  product.prices = { lider: 2190 };
  product.skus = { lider: { sku: 'L-1', gtin: null, url: null, exact: true, verifiedAt: NOW } };
  delete product.offers;
  const { data } = normalizeFeed(legacy, { now: () => T });
  assert.equal(data.products[0].prices.lider, 2190);
  assert.equal(data.products[0].skus.lider.sku, 'L-1');
});

test('normalizeFeed rechaza precios inválidos, cadenas desconocidas y SKU hostil', () => {
  const feed = feedFixture();
  feed.products[0].offers = [
    { chainId: 'jumbo', price: -1, capturedAt: NOW, sku: 'OK' },
    { chainId: 'inexistente', price: 1000, capturedAt: NOW, sku: 'OK' },
    { chainId: 'jumbo', price: 1200, capturedAt: NOW, sku: "x' OR 1=1" },
  ];
  const { data, report } = normalizeFeed(feed, { now: () => T });
  assert.equal(report.validOffers, 1);
  assert.equal(data.products[0].skus.jumbo.sku, null);
  assert.ok(report.rejected.some((r) => r.reason.includes('SKU/GTIN inválido')));
  assert.ok(report.rejected.some((r) => r.reason.includes('cadena no reconocida')));
  assert.ok(report.rejected.some((r) => r.reason.includes('precio inválido')));
});

test('normalizeFeed descarta URL rechazada pero conserva el fallback exacto', () => {
  const feed = feedFixture();
  const product = feed.products[0];
  product.name = 'Nombre que jamás debe usarse como búsqueda';
  product.offers[0].url = 'https://jumbo.cl.evil.com/ficha';
  const { data, report } = normalizeFeed(feed, {
    now: () => T,
    validateUrl: (value) => (value.includes('evil') ? null : value),
  });
  assert.equal(data.products[0].skus.jumbo.url, null);
  assert.equal(data.products[0].skus.jumbo.sku, 'ABC-1');
  assert.equal(data.products[0].skus.jumbo.exact, true);
  assert.ok(report.rejected.some((r) => r.reason.includes('URL canónica')));
  assert.ok(!JSON.stringify(data).includes('busqueda?ft=' + encodeURIComponent(product.name)));
});

test('normalizeFeed reporta timestamps ausentes y redondea decimales', () => {
  const feed = feedFixture();
  delete feed.products[0].offers[0].capturedAt;
  delete feed.meta.generatedAt;
  const { data, report } = normalizeFeed(feed, { now: () => T });
  assert.equal(report.timestampMissing, 2);
  assert.equal(data.products[0].skus.jumbo.capturedAt, new Date(T).toISOString());
  assert.equal(data.meta.generatedAt, new Date(T).toISOString());
  assert.ok(report.warnings.some((w) => w.includes('generatedAt')));
});

test('normalizeFeed redondea precios decimales y avisa', () => {
  const feed = feedFixture();
  feed.products[0].offers[0].price = 1990.6;
  const { data, report } = normalizeFeed(feed, { now: () => T });
  assert.equal(data.products[0].prices.jumbo, 1991);
  assert.ok(report.warnings.some((w) => w.includes('redondeado')));
});

test('normalizeFeed rechaza feeds sin products y catálogos desproporcionados', () => {
  assert.throws(() => normalizeFeed({ meta: {} }, { now: () => T }), /falta products/);
  const feed = feedFixture();
  feed.products = new Array(5001).fill(feedFixture().products[0]);
  assert.throws(() => normalizeFeed(feed, { now: () => T }), /máximo de 5000/);
});

test('CHAIN_IDS sigue siendo el contrato de 6 cadenas del feed', () => {
  assert.deepEqual(CHAIN_IDS, ['lider', 'jumbo', 'santaisabel', 'tottus', 'unimarc', 'coope']);
});

test('getPrices normaliza el feed remoto y expone metadata de integración', async () => {
  const res = await getPrices('leche', depsFor());
  assert.equal(res.meta.mode, 'live');
  assert.equal(res.meta.source, 'https://feed.test/precios');
  assert.equal(res.meta.feedVersion, FEED_SCHEMA_VERSION);
  assert.equal(res.meta.capturedAt, NOW);
  assert.equal(res.meta.stale, false);
  assert.equal(res.meta.query, 'leche');
  assert.equal(res.products[0].prices.jumbo, 1990);
  assert.equal(res.meta.integration.report.validOffers, 1);
  assert.equal(res.meta.integration.breakers.upstream.upstream.state, 'closed');
});

test('getPrices respeta el TTL: una sola llamada dentro de la ventana', async () => {
  let calls = 0;
  let t = T;
  const deps = depsFor({
    now: () => t,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => feedFixture() };
    },
  });
  await getPrices('', deps);
  await getPrices('', deps);
  assert.equal(calls, 1);
  t += FEED_TTL_MS + 1;
  await getPrices('', deps);
  assert.equal(calls, 2);
});

test('getPrices ante HTTP 403 pausa el conector y cae al demo sin marcar enlace roto', async () => {
  const breaker = createCircuitBreaker({ threshold: 1, cooldownMs: 60_000, now: () => T });
  const deps = depsFor({
    breaker,
    fetchImpl: async () => ({ ok: false, status: 403, headers: { get: () => null } }),
  });
  const res = await getPrices('', deps);
  assert.equal(res.meta.mode, 'demo');
  assert.ok(res.meta.integration.warnings.some((w) => w.includes('HTTP 403')));
  assert.equal(res.meta.integration.breakers.upstream.upstream.state, 'open');
  assert.match(res.meta.integration.warnings.join(' '), /renegociar|pausad|enfriamiento/i);
});

test('getPrices ante 429 respeta Retry-After para el enfriamiento', async () => {
  const breaker = createCircuitBreaker({ threshold: 1, cooldownMs: 60_000, now: () => T });
  const deps = depsFor({
    breaker,
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? '120' : null) },
    }),
  });
  const res = await getPrices('', deps);
  assert.equal(res.meta.mode, 'demo');
  assert.equal(breaker.snapshot().upstream.nextRetryInMs, 120_000);
});

test('getPrices con breaker abierto sirve caché vencida marcada como stale', async () => {
  let t = T;
  let calls = 0;
  // TTL corto y pausa larga: la caché vence antes de que el breaker reintente.
  const cache = createFeedCache({ ttlMs: 60_000, now: () => t });
  const breaker = createCircuitBreaker({ threshold: 1, cooldownMs: 300_000, now: () => t });
  const deps = depsFor({
    now: () => t,
    cache,
    breaker,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => feedFixture() };
    },
  });
  await getPrices('', deps);
  assert.equal(calls, 1);
  breaker.recordFailure('upstream', 300_000);
  t += 60_001;
  const res = await getPrices('', deps);
  assert.equal(calls, 1);
  assert.equal(res.meta.mode, 'live');
  assert.equal(res.meta.stale, true);
  assert.ok(res.meta.integration.warnings.some((w) => w.includes('pausa')));
});

test('getPrices consume el feed local con el mismo normalizador', async () => {
  const deps = depsFor({
    upstream: null,
    existsSync: () => true,
    readFileSync: () => JSON.stringify(feedFixture()),
  });
  const res = await getPrices('', deps);
  assert.equal(res.meta.mode, 'live');
  assert.equal(res.meta.source, 'data/live-prices.json');
  assert.equal(res.products[0].prices.jumbo, 1990);
});

test('getPrices marca stale un feed con timestamp antiguo', async () => {
  const old = new Date(T - 3_600_000).toISOString();
  const feed = feedFixture({ offers: undefined });
  feed.products[0].offers = [
    { chainId: 'jumbo', price: 1990, capturedAt: old, sku: 'ABC-1', url: null },
  ];
  feed.meta.generatedAt = old;
  const res = await getPrices('', depsFor({ feed }));
  assert.equal(res.meta.mode, 'live');
  assert.equal(res.meta.stale, true);
  assert.equal(res.meta.ageSeconds, 3600);
});

test('verifyLink con 403 persistente pausa la cadena y no contacta el host nuevamente', async () => {
  const breaker = createCircuitBreaker({ threshold: 1, cooldownMs: 60_000, now: () => T });
  const cache = new Map();
  const first = await verifyLink('https://www.jumbo.cl/x', {
    fetch: async () => ({ ok: false, status: 403, url: 'https://www.jumbo.cl/x' }),
    cache,
    breaker,
    now: () => T,
  });
  assert.equal(first.paused, true);
  assert.equal(first.status, 403);
  assert.equal(cache.size, 0);
  assert.equal(breaker.snapshot().jumbo.state, 'open');

  let calls = 0;
  const second = await verifyLink('https://www.jumbo.cl/x', {
    fetch: async () => {
      calls += 1;
      return { ok: true, status: 200, url: 'https://www.jumbo.cl/x' };
    },
    cache: new Map(),
    breaker,
    now: () => T,
  });
  assert.equal(calls, 0);
  assert.equal(second.paused, true);
  assert.match(second.error, /pausada para jumbo/);
});

test('verifyLink con 429 usa Retry-After y no marca el enlace como roto', async () => {
  const breaker = createCircuitBreaker({ threshold: 1, cooldownMs: 60_000, now: () => T });
  const result = await verifyLink('https://www.jumbo.cl/x', {
    fetch: async () => ({
      ok: false,
      status: 429,
      url: 'https://www.jumbo.cl/x',
      headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? '45' : null) },
    }),
    cache: new Map(),
    breaker,
    now: () => T,
  });
  assert.equal(result.paused, true);
  assert.equal(result.ok, false);
  assert.equal(breaker.snapshot().jumbo.nextRetryInMs, 45_000);
  assert.match(result.error, /pausado/);
});

test('verifyLink con 403 en HEAD y 200 en GET cierra el breaker normalmente', async () => {
  const breaker = createCircuitBreaker({ threshold: 1, cooldownMs: 60_000, now: () => T });
  const result = await verifyLink('https://www.jumbo.cl/x', {
    fetch: async (_url, opts) => ({
      ok: opts.method === 'GET',
      status: opts.method === 'GET' ? 200 : 403,
      url: 'https://www.jumbo.cl/x',
    }),
    cache: new Map(),
    breaker,
    now: () => T,
  });
  assert.equal(result.ok, true);
  assert.equal(breaker.snapshot().jumbo.state, 'closed');
});

test('chainForUrl mapea hosts permitidos y rechaza dominios engañosos', () => {
  assert.equal(chainForUrl('https://www.lider.cl/x'), 'lider');
  assert.equal(chainForUrl('https://santaisabel.cl/x'), 'santaisabel');
  assert.equal(chainForUrl('https://coope.cl/x'), 'coope');
  assert.equal(chainForUrl('https://jumbo.cl.evil.com/x'), null);
  assert.equal(chainForUrl('no-es-url'), null);
});

test('GET /api/feed-status expone TTL, caché y breakers sin red externa', async () => {
  const res = await fetch(`${serverBase}/api/feed-status`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.feedVersion, FEED_SCHEMA_VERSION);
  assert.equal(json.ttlMs, FEED_TTL_MS);
  assert.equal(typeof json.cache, 'object');
  assert.ok(json.breakers.upstream);
  assert.ok(json.breakers.links);
});
