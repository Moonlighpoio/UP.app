import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  API_BASE_URL,
  SOURCE_ID,
  createPrictoClient,
  ean13,
  hasSampleData,
  isLiveKey,
  normalizePrice,
} = require('../lib/pricto.js');

const NOW = Date.parse('2026-11-24T12:00:00.000Z');
const ATTRIBUTION = {
  text: 'Fuente: Pricto · Jumbo, página pública, 24-11-2026 09:00 CLST · jumbo.cl/… · ofr_1',
  source: 'Pricto',
  as_of: new Date(NOW).toISOString(),
  url: `${API_BASE_URL}/products/prd_1/prices`,
  source_url: null,
};

function rawPrice(overrides = {}) {
  return {
    currency: 'CLP',
    price: 1990,
    quality_status: 'ok',
    quality_flags: [],
    availability: 'in_stock',
    capture_method: 'public_page',
    observed_at: new Date(NOW - 60 * 60 * 1000).toISOString(),
    retailer: { id: 'cl-jumbo', name: 'Jumbo' },
    offer_id: 'ofr_1',
    url: 'https://www.jumbo.cl/productos/coca-original-15l',
    match: { method: 'gtin', confidence: 0.99, kind: 'identical', pack_ratio: null },
    ...overrides,
  };
}

function accepted(overrides = {}) {
  return normalizePrice(rawPrice(overrides), {
    chainId: 'jumbo',
    attribution: ATTRIBUTION,
    now: () => NOW,
  });
}

function jsonResponse(body, status = 200, headers = {}) {
  return {
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] || null },
    json: async () => body,
  };
}

function pricePayload(overrides = {}) {
  return {
    data: { product: { id: 'prd_1', gtin: ['7801610001622'] }, prices: [rawPrice()] },
    meta: { attribution: ATTRIBUTION, usage: { credits_charged: 1 }, warnings: [] },
    ...overrides,
  };
}

function depsFor(responder, overrides = {}) {
  const calls = [];
  const sleeps = [];
  const breaker = {
    allow: () => true,
    recordSuccess() {},
    recordFailure() {},
    snapshot: () => ({}),
  };
  return {
    apiKey: 'sk_live_testkey12345',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return responder(url, options, calls.length);
    },
    now: () => NOW,
    sleep: async (ms) => sleeps.push(ms),
    random: () => 0,
    throttle: { wait: async () => 0 },
    breaker,
    robotsGuard: { check: async () => ({ allowed: true }) },
    calls,
    sleeps,
    ...overrides,
  };
}

test('sólo se acepta una key real de cuenta; sandbox y vacío se rechazan', () => {
  assert.equal(isLiveKey('sk_live_abc12345'), true);
  assert.equal(isLiveKey('sk_test_sandbox'), false);
  assert.equal(isLiveKey(''), false);
  assert.equal(isLiveKey(undefined), false);
  assert.throws(() => createPrictoClient({ apiKey: 'sk_test_sandbox' }), /sk_live_/);
});

test('GTIN EAN-13 y warnings de datos sintéticos', () => {
  assert.equal(ean13('7801610001622'), true);
  assert.equal(ean13('24851794'), false);
  assert.equal(hasSampleData({ warnings: ['synthetic_data: datos sintéticos'] }), true);
  assert.equal(hasSampleData({ warnings: ['ofertas de tipo pack'] }), false);
});

test('normaliza una oferta válida con procedencia completa', () => {
  const result = accepted();
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    chainId: 'jumbo',
    price: 1990,
    sourceUrl: 'https://www.jumbo.cl/productos/coca-original-15l',
    capturedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    priceSource: SOURCE_ID,
    priceSourceUrl: ATTRIBUTION.url,
    priceAttribution: ATTRIBUTION.text,
    offerId: 'ofr_1',
    retailerName: 'Jumbo',
  });
});

test('rechaza URL inventada, coincidencia no idéntica, baja confianza y retailer ajeno', () => {
  assert.match(accepted({ url: 'https://example.com/cl-jumbo/x' }).reason, /whitelist/);
  assert.match(accepted({ url: 'http://www.jumbo.cl/x' }).reason, /whitelist/);
  assert.match(
    accepted({ match: { method: 'gtin', kind: 'pack', confidence: 0.99 } }).reason,
    /idéntica/
  );
  assert.match(
    accepted({ match: { method: 'gtin', kind: 'identical', confidence: 0.8 } }).reason,
    /confianza/
  );
  assert.match(
    accepted({ retailer: { id: 'cl-unimarc', name: 'Unimarc' } }).reason,
    /no autorizado/
  );
});

test('rechaza calidad, disponibilidad, método, moneda, antigüedad y atribución inválidos', () => {
  assert.match(accepted({ quality_status: 'warning' }).reason, /calidad/);
  assert.match(accepted({ quality_flags: ['dudoso'] }).reason, /calidad/);
  assert.match(accepted({ availability: 'out_of_stock' }).reason, /disponibilidad/);
  assert.match(accepted({ capture_method: null }).reason, /capture_method/);
  assert.match(accepted({ currency: 'USD' }).reason, /CLP/);
  assert.match(accepted({ price: 19.5 }).reason, /CLP/);
  assert.match(
    accepted({ observed_at: new Date(NOW - 49 * 3600_000).toISOString() }).reason,
    /48 h/
  );
  assert.match(
    accepted({ observed_at: new Date(NOW + 5 * 60_000).toISOString() }).reason,
    /futuro/
  );
  const withoutAttribution = normalizePrice(rawPrice(), { chainId: 'jumbo', now: () => NOW });
  assert.match(withoutAttribution.reason, /atribución/);
});

test('403/429 pausa el conector sin reintentos ni evasión', async () => {
  for (const status of [403, 429]) {
    const deps = depsFor(() => jsonResponse({}, status, { 'retry-after': '60' }));
    const client = createPrictoClient(deps);
    const result = await client.getPrices('prd_1', 'jumbo');
    assert.equal(result.ok, false);
    assert.equal(result.paused, true);
    assert.equal(result.status, status);
    assert.equal(deps.calls.length, 1, 'un 403/429 no se reintenta');
  }
});

test('reintentos transitorios con jitter acotado y sin exponer la key', async () => {
  const deps = depsFor((_url, _opts, call) =>
    call === 1 ? jsonResponse({}, 503) : jsonResponse(pricePayload())
  );
  const client = createPrictoClient(deps);
  const result = await client.getPrices('prd_1', 'jumbo');
  assert.equal(result.ok, true);
  assert.equal(deps.calls.length, 2);
  assert.equal(deps.sleeps.length, 1);
  assert.ok(deps.sleeps[0] >= 1000);
  assert.equal(JSON.stringify(result).includes('testkey12345'), false);
});

test('cabeceras condicionales: ETag reutilizado y 304 sin recargar el cuerpo', async () => {
  const deps = depsFor((_url, _opts, call) =>
    call === 1
      ? jsonResponse(pricePayload(), 200, { etag: '"abc"' })
      : jsonResponse(null, 304, { etag: '"abc"' })
  );
  const client = createPrictoClient(deps);
  const first = await client.getPrices('prd_1', 'jumbo');
  const second = await client.getPrices('prd_1', 'jumbo');
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.notModified, true);
  assert.equal(deps.calls[1].options.headers['If-None-Match'], '"abc"');
});

test('respuesta con datos sintéticos se descarta aunque venga con HTTP 200', async () => {
  const deps = depsFor(() =>
    jsonResponse(pricePayload({ meta: { ...pricePayload().meta, warnings: ['synthetic_data'] } }))
  );
  const client = createPrictoClient(deps);
  const result = await client.getPrices('prd_1', 'jumbo');
  assert.equal(result.ok, false);
  assert.match(result.reason, /sintéticos/);
});

test('listProducts mapea GTIN a producto y marca ambigüedades como fail closed', async () => {
  const deps = depsFor(() =>
    jsonResponse({
      data: [
        { id: 'prd_1', gtin: ['7801610001622'] },
        { id: 'prd_2', gtin: ['7801610001622'] },
      ],
      pagination: { has_more: false },
      meta: { attribution: ATTRIBUTION, usage: { credits_charged: 1 }, warnings: [] },
    })
  );
  const client = createPrictoClient(deps);
  const listed = await client.listProducts(['7801610001622', '24851794']);
  assert.equal(listed.ok, true);
  assert.equal(listed.products.length, 2);
  assert.equal(listed.byGtin.get('7801610001622'), null);
  assert.equal(listed.byGtin.has('24851794'), false);
  assert.ok(deps.calls[0].url.includes('gtin=7801610001622'));

  const dry = depsFor(() =>
    jsonResponse({
      data: null,
      meta: {
        attribution: ATTRIBUTION,
        usage: { credits_charged: 0, credits_quoted: 1, dry_run: true },
        warnings: [],
      },
    })
  );
  const quoted = await createPrictoClient(dry).listProducts(['7801610001622'], { dryRun: true });
  assert.equal(quoted.ok, true);
  assert.deepEqual(quoted.products, []);
  assert.equal(quoted.quote.credits_quoted, 1);
  assert.ok(dry.calls[0].url.includes('dry_run=true'));
});
