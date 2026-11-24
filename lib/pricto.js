/**
 * UP · Adapter de Pricto (Fase 6), sin dependencias externas.
 * ---------------------------------------------------------------------------
 * Fuente autorizada de precios reales. Nunca se usa la sandbox (`sk_test_…`):
 * sus precios, GTIN y URLs son inventados y sus términos prohíben presentarlos
 * como reales. Sólo se aceptan ofertas con coincidencia GTIN `identical`,
 * confianza ≥ 0.85, calidad `ok`, CLP, URL de ficha de la cadena permitida y
 * línea de atribución devuelta por la API.
 *
 * Un 403/429 PAUSA el conector (sin evasión ni reintentos agresivos). Todas las
 * dependencias de red/tiempo son inyectables para que los tests sean
 * deterministas y no contacten a Pricto.
 */
const { createCircuitBreaker, parseRetryAfterMs, PAUSE_STATUSES } = require('./feed.js');
const {
  backoffWithJitter,
  conditionalHeaders,
  createDomainThrottle,
  createRobotsGuard,
  USER_AGENT,
} = require('./link-policy.js');

const SOURCE_ID = 'pricto';
const SOURCE_NAME = 'Pricto';
const API_BASE_URL = 'https://pricto.dev/v1';
const ALLOWED_HOSTS = new Set(['pricto.dev', 'www.pricto.dev']);
const RETAILER_BY_CHAIN = Object.freeze({
  jumbo: 'cl-jumbo',
  santaisabel: 'cl-santaisabel',
  unimarc: 'cl-unimarc',
});
const DOMAIN_BY_CHAIN = Object.freeze({
  jumbo: 'jumbo.cl',
  santaisabel: 'santaisabel.cl',
  unimarc: 'unimarc.cl',
});
const MIN_CONFIDENCE = 0.85;
const MAX_OBSERVATION_AGE_MS = 48 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;
const CAPTURE_METHODS = new Set(['public_page', 'public_api', 'retailer_feed', 'open_data']);
const TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);
const MAX_RETRIES = 2;
const TIMEOUT_MS = 10_000;

function ean13(value) {
  if (typeof value !== 'string' || !/^\d{13}$/.test(value)) return false;
  const body = value.slice(0, 12);
  const sum = [...body].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0
  );
  return (10 - (sum % 10)) % 10 === Number(value[12]);
}

/** La única credencial aceptada es una key real de cuenta propia. Nunca se registra. */
function isLiveKey(key) {
  return typeof key === 'string' && /^sk_live_[A-Za-z0-9._-]{8,}$/.test(key.trim());
}

function header(res, name) {
  if (!res || typeof res.headers?.get !== 'function') return null;
  return res.headers.get(name);
}

function allowedHost(url, hosts) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === 'https:' &&
      (hosts.has(host) || [...hosts].some((h) => host.endsWith('.' + h)))
    );
  } catch {
    return false;
  }
}

function isPrictoUrl(url) {
  return allowedHost(url, ALLOWED_HOSTS);
}

function retailerUrlFor(url, chainId) {
  const domain = DOMAIN_BY_CHAIN[chainId];
  if (!domain || !allowedHost(url, new Set([domain]))) return null;
  return new URL(url).toString();
}

/** La sandbox se delata en `meta.warnings`; cualquier muestra se rechaza. */
function hasSampleData(meta) {
  return (Array.isArray(meta?.warnings) ? meta.warnings : []).some((warning) =>
    /synthetic|sample|sintetic|datos sintéticos|de ejemplo/i.test(String(warning))
  );
}

/** Atribución obligatoria: sin ella no se publica ningún precio. */
function attributionFrom(meta, requestUrl) {
  const attribution = meta?.attribution;
  if (!attribution || typeof attribution.text !== 'string' || !attribution.text.trim()) return null;
  if (typeof attribution.source !== 'string' || !attribution.source.trim()) return null;
  const candidates = [attribution.source_url, attribution.url, requestUrl];
  const url = candidates.find((value) => typeof value === 'string' && isPrictoUrl(value));
  if (!url) return null;
  return { text: attribution.text.trim(), source: attribution.source.trim(), url };
}

/** Convierte una oferta de Pricto a procedencia verificable, o la rechaza. */
function normalizePrice(raw, { chainId, attribution, now = Date.now } = {}) {
  const retailer = RETAILER_BY_CHAIN[chainId];
  if (!retailer) return { ok: false, reason: `cadena ${chainId} sin cobertura Pricto` };
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'oferta ausente' };
  if (raw.retailer?.id !== retailer) {
    return { ok: false, reason: `retailer ${raw.retailer?.id} no autorizado para ${chainId}` };
  }
  if (raw.currency !== 'CLP' || !Number.isInteger(raw.price) || raw.price <= 0) {
    return { ok: false, reason: 'precio no CLP entero positivo' };
  }
  if (
    raw.quality_status !== 'ok' ||
    (Array.isArray(raw.quality_flags) && raw.quality_flags.length)
  ) {
    return { ok: false, reason: 'calidad no verificable' };
  }
  if (raw.availability !== 'in_stock') {
    return { ok: false, reason: `disponibilidad ${raw.availability} no comparable` };
  }
  if (!CAPTURE_METHODS.has(raw.capture_method)) {
    return { ok: false, reason: `capture_method ${raw.capture_method} no autorizado` };
  }
  const match = raw.match || {};
  if (
    match.kind !== 'identical' ||
    match.method !== 'gtin' ||
    typeof match.confidence !== 'number' ||
    match.confidence < MIN_CONFIDENCE
  ) {
    return { ok: false, reason: 'coincidencia no idéntica por GTIN o confianza < 0.85' };
  }
  if (typeof raw.offer_id !== 'string' || !raw.offer_id.trim()) {
    return { ok: false, reason: 'offer_id ausente' };
  }
  const timestamp = typeof raw.observed_at === 'string' ? Date.parse(raw.observed_at) : NaN;
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'observed_at inválido' };
  const ageMs = now() - timestamp;
  if (ageMs < -MAX_CLOCK_SKEW_MS) return { ok: false, reason: 'observed_at en el futuro' };
  if (ageMs > MAX_OBSERVATION_AGE_MS) {
    return { ok: false, reason: 'observación con más de 48 h' };
  }
  const sourceUrl = retailerUrlFor(raw.url, chainId);
  if (!sourceUrl) return { ok: false, reason: 'URL de ficha fuera de la whitelist de la cadena' };
  if (!attribution) return { ok: false, reason: 'atribución ausente' };

  return {
    ok: true,
    value: {
      chainId,
      price: raw.price,
      sourceUrl,
      capturedAt: new Date(timestamp).toISOString(),
      priceSource: SOURCE_ID,
      priceSourceUrl: attribution.url,
      priceAttribution: attribution.text,
      offerId: raw.offer_id.trim(),
      retailerName: raw.retailer.name || SOURCE_NAME,
    },
  };
}

/**
 * Cliente con límite de créditos, robots.txt, ritmo por dominio, ETag/Last-Modified,
 * reintentos con jitter y circuit breaker. La key vive sólo en memoria.
 */
function createPrictoClient({
  apiKey,
  fetchImpl = fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
  baseUrl = API_BASE_URL,
  userAgent = USER_AGENT,
  throttle = createDomainThrottle({ now, sleep, random }),
  breaker = createCircuitBreaker({ now }),
  robotsGuard = createRobotsGuard(),
  maxCredits = Infinity,
} = {}) {
  if (!isLiveKey(apiKey)) {
    throw new Error('PRICTO_API_KEY ausente o no válida: se requiere sk_live_ de cuenta propia');
  }
  let base;
  try {
    base = new URL(baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  } catch {
    throw new Error('baseUrl de Pricto inválida');
  }
  if (base.protocol !== 'https:' || !ALLOWED_HOSTS.has(base.hostname.toLowerCase())) {
    throw new Error('baseUrl de Pricto fuera de la whitelist');
  }
  const origin = base.origin;
  const conditional = new Map();
  let creditsCharged = 0;
  const budget = Number.isFinite(maxCredits) ? Math.max(0, maxCredits) : Infinity;

  async function request(pathname, params = {}, { dryRun = false } = {}) {
    const url = new URL(pathname, base);
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
    }
    if (dryRun) url.searchParams.set('dry_run', 'true');
    const remaining = budget - creditsCharged;
    if (remaining <= 0) return { ok: false, reason: 'presupuesto de créditos agotado', status: 0 };
    if (Number.isFinite(remaining)) {
      url.searchParams.set('max_credits', String(Math.ceil(remaining)));
    }
    const target = url.toString();

    if (!breaker.allow(origin)) {
      return {
        ok: false,
        paused: true,
        status: 0,
        reason: 'circuit breaker abierto; sin reintentos hasta el enfriamiento',
      };
    }
    const robots = await robotsGuard.check(target, { fetch: fetchImpl, userAgent, now });
    if (!robots.allowed) {
      return {
        ok: false,
        paused: Boolean(robots.paused),
        status: robots.status || 0,
        reason: robots.error || 'robots.txt no permite la petición; verificación omitida',
      };
    }

    const cached = conditional.get(target);
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      await throttle.wait(origin, robots.crawlDelayMs);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let res;
      try {
        res = await fetchImpl(target, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'User-Agent': userAgent,
            Accept: 'application/json',
            ...conditionalHeaders(cached?.etag, cached?.lastModified),
          },
          signal: controller.signal,
        });
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          await sleep(backoffWithJitter(attempt, { random }));
          continue;
        }
        breaker.recordFailure(origin);
        return { ok: false, status: 0, reason: `fallo de red: ${err.message}` };
      } finally {
        clearTimeout(timer);
      }

      const status = res.status;
      if (status === 304 && cached) {
        breaker.recordSuccess(origin);
        return {
          ok: true,
          data: cached.data,
          meta: cached.meta,
          pagination: cached.pagination,
          url: target,
          notModified: true,
        };
      }
      if (PAUSE_STATUSES.has(status)) {
        const retryAfterMs = parseRetryAfterMs(header(res, 'retry-after'), now);
        breaker.recordFailure(origin, retryAfterMs);
        return {
          ok: false,
          paused: true,
          status,
          retryAfterMs,
          reason: `Pricto pausó el conector (HTTP ${status}); sin evasión ni reintentos`,
        };
      }
      if (TRANSIENT_STATUSES.has(status) && attempt < MAX_RETRIES) {
        await sleep(backoffWithJitter(attempt, { random }));
        continue;
      }
      if (status !== 200) {
        breaker.recordFailure(origin);
        const reason =
          status === 401
            ? 'credencial rechazada (HTTP 401); no se reintenta'
            : `respuesta HTTP ${status}`;
        return { ok: false, status, reason };
      }
      let payload;
      try {
        payload = await res.json();
      } catch {
        breaker.recordFailure(origin);
        return { ok: false, status, reason: 'respuesta JSON inválida' };
      }
      const meta = payload?.meta;
      if (!meta || hasSampleData(meta) || !attributionFrom(meta, target)) {
        breaker.recordFailure(origin);
        return {
          ok: false,
          status,
          reason: 'respuesta sin atribución verificable o con datos sintéticos; descartada',
        };
      }
      if (meta.usage?.truncated === true) {
        return {
          ok: false,
          status,
          reason: 'respuesta truncada por el límite de créditos; sin escritura parcial',
        };
      }
      const charged = Number(meta.usage?.credits_charged);
      if (Number.isFinite(charged) && charged > 0) creditsCharged += charged;
      breaker.recordSuccess(origin);
      conditional.set(target, {
        etag: header(res, 'etag'),
        lastModified: header(res, 'last-modified'),
        data: payload.data,
        meta,
        pagination: payload.pagination,
      });
      return { ok: true, data: payload.data, meta, pagination: payload.pagination, url: target };
    }
    return { ok: false, status: 0, reason: 'reintentos agotados' };
  }

  async function listProducts(gtins, { dryRun = false } = {}) {
    const unique = [...new Set(gtins.filter(ean13))];
    if (!unique.length) return { ok: false, reason: 'sin GTIN EAN-13 válidos' };
    const products = [];
    let cursor = null;
    let quote = null;
    for (let page = 0; page < 5; page += 1) {
      const res = await request(
        'products',
        {
          gtin: unique.join(','),
          country: 'CL',
          limit: 100,
          ...(cursor ? { cursor } : {}),
        },
        { dryRun }
      );
      if (!res.ok) return res;
      quote = res.meta?.usage || null;
      const batch = Array.isArray(res.data) ? res.data : [];
      products.push(...batch);
      if (!res.pagination?.has_more) break;
      cursor = res.pagination.next_cursor;
      if (!cursor) break;
    }
    const byGtin = new Map();
    for (const product of products) {
      for (const gtin of Array.isArray(product.gtin) ? product.gtin : []) {
        if (!ean13(gtin)) continue;
        if (byGtin.has(gtin))
          byGtin.set(gtin, null); // ambigüedad: fail closed
        else byGtin.set(gtin, product.id);
      }
    }
    return { ok: true, products, byGtin, quote };
  }

  async function getPrices(productId, chainId, { dryRun = false } = {}) {
    const retailer = RETAILER_BY_CHAIN[chainId];
    if (!retailer) return { ok: false, reason: `cadena ${chainId} sin cobertura Pricto` };
    const res = await request(
      `products/${encodeURIComponent(productId)}/prices`,
      {
        retailer,
        min_confidence: MIN_CONFIDENCE,
        match_kinds: 'identical',
        include_unavailable: 'false',
        currency: 'local', // sin conversiones: se valida que el origen sea CLP
      },
      { dryRun }
    );
    if (!res.ok) return res;
    const attribution = attributionFrom(res.meta, res.url);
    const rawPrices = Array.isArray(res.data?.prices) ? res.data.prices : [];
    const accepted = [];
    const rejected = [];
    for (const raw of rawPrices) {
      const result = normalizePrice(raw, { chainId, attribution, now });
      if (result.ok) accepted.push(result.value);
      else rejected.push(result.reason);
    }
    if (accepted.length !== 1) {
      return {
        ok: false,
        reason:
          accepted.length > 1
            ? `ofertas ambiguas para ${chainId} (${accepted.length}); sin escritura`
            : rejected[0] || 'sin oferta verificable',
        rejected,
      };
    }
    return {
      ok: true,
      offer: accepted[0],
      rejected,
      meta: res.meta,
      ...(res.notModified ? { notModified: true } : {}),
    };
  }

  function snapshot() {
    return {
      source: SOURCE_ID,
      origin,
      creditsCharged,
      budget: budget === Infinity ? null : budget,
      conditionalEntries: conditional.size,
      breaker: breaker.snapshot(),
    };
  }

  return { listProducts, getPrices, snapshot };
}

module.exports = {
  SOURCE_ID,
  SOURCE_NAME,
  API_BASE_URL,
  RETAILER_BY_CHAIN,
  DOMAIN_BY_CHAIN,
  MIN_CONFIDENCE,
  MAX_OBSERVATION_AGE_MS,
  ean13,
  isLiveKey,
  hasSampleData,
  attributionFrom,
  normalizePrice,
  createPrictoClient,
};
