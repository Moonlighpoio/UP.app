/**
 * UP · Capa de integración de feeds autorizados (sin scraping).
 * ---------------------------------------------------------------------------
 * Funciones puras y deterministas: normalizan el contrato de datos reales,
 * gestionan TTL de caché y circuit breakers por fuente/cadena.
 *
 * Regla crítica: una oferta válida necesita precio + timestamp + (SKU o GTIN)
 * y, opcionalmente, una URL canónica. Nunca se construye una URL desde el
 * nombre del producto. Un 403/429 es una PAUSA, no un enlace roto.
 */

const CHAIN_IDS = ['lider', 'jumbo', 'santaisabel', 'tottus', 'unimarc', 'coope'];
const PAUSE_STATUSES = new Set([403, 429]);
const TOKEN_RE = /^[A-Za-z0-9._-]{1,40}$/;
const MAX_PRODUCTS = 5000;
const MAX_OFFERS = 20;
const MAX_WARNINGS = 50;
const MAX_RETRY_AFTER_MS = 5 * 60 * 1000;

function toIso(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function classifyStatus(status) {
  if (PAUSE_STATUSES.has(status)) return 'pause';
  return Number.isInteger(status) && status >= 200 && status < 300 ? 'ok' : 'error';
}

/** Respeta Retry-After (segundos o fecha HTTP) con tope de 5 minutos. */
function parseRetryAfterMs(value, now = Date.now) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) {
    return Math.min(MAX_RETRY_AFTER_MS, Number(raw) * 1000);
  }
  const date = Date.parse(raw);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, Math.min(MAX_RETRY_AFTER_MS, date - now()));
}

/**
 * Circuit breaker con tres estados: closed → open → half-open → closed.
 * Solo 403/429 cuentan como fallo: son señales de "pausar y renegociar".
 */
function createCircuitBreaker({ threshold = 3, cooldownMs = 60_000, now = Date.now } = {}) {
  const entries = new Map();

  function entry(key) {
    let value = entries.get(key);
    if (!value) {
      value = { state: 'closed', failures: 0, openedAt: null, openedUntil: 0 };
      entries.set(key, value);
    }
    if (value.state === 'open' && now() >= value.openedUntil) value.state = 'half-open';
    return value;
  }

  return {
    threshold,
    cooldownMs,
    allow(key) {
      return entry(key).state !== 'open';
    },
    recordSuccess(key) {
      const value = entry(key);
      value.state = 'closed';
      value.failures = 0;
      value.openedAt = null;
      value.openedUntil = 0;
    },
    recordFailure(key, retryAfterMs) {
      const value = entry(key);
      value.failures += 1;
      // En half-open basta un nuevo fallo para volver a pausar.
      if (value.failures >= threshold || value.state === 'half-open') {
        const wait = Number.isFinite(retryAfterMs)
          ? Math.max(1000, Math.min(MAX_RETRY_AFTER_MS, retryAfterMs))
          : cooldownMs;
        value.state = 'open';
        value.openedAt = now();
        value.openedUntil = now() + wait;
      }
    },
    snapshot() {
      const out = {};
      for (const key of entries.keys()) {
        const current = entry(key);
        out[key] = {
          state: current.state,
          failures: current.failures,
          nextRetryInMs: current.state === 'open' ? Math.max(0, current.openedUntil - now()) : 0,
        };
      }
      return out;
    },
    reset() {
      entries.clear();
    },
  };
}

/** Caché en memoria con TTL. Un entry vencido se sirve marcado como stale. */
function createFeedCache({ ttlMs = 15 * 60 * 1000, now = Date.now } = {}) {
  const entries = new Map();

  function describe(key, value) {
    const ageMs = Math.max(0, now() - value.fetchedAt);
    return {
      key,
      fetchedAt: new Date(value.fetchedAt).toISOString(),
      ageMs,
      stale: ageMs > ttlMs,
      expiresAt: new Date(value.fetchedAt + ttlMs).toISOString(),
    };
  }

  return {
    ttlMs,
    get(key) {
      const value = entries.get(key);
      if (!value) return null;
      return Object.assign(
        { data: value.data, report: value.report || null },
        describe(key, value)
      );
    },
    set(key, data, report = null) {
      entries.set(key, { data, report, fetchedAt: now() });
    },
    snapshot() {
      const out = {};
      for (const [key, value] of entries) out[key] = describe(key, value);
      return out;
    },
    reset() {
      entries.clear();
    },
  };
}

function defaultValidateUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Normaliza un feed autorizado a la forma que ya consume el front-end.
 * Acepta el contrato nuevo (`offers`) y el legado (`prices` + `skus`).
 *
 * @returns {{data: object, report: object}}
 */
function normalizeFeed(raw, options = {}) {
  const now = options.now || Date.now;
  const validateUrl = options.validateUrl || defaultValidateUrl;
  const source = options.source || 'feed';
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.products)) {
    throw new Error('Feed inválido: falta products[]');
  }
  if (raw.products.length > MAX_PRODUCTS) {
    throw new Error(`Feed excede el máximo de ${MAX_PRODUCTS} productos`);
  }

  const report = {
    source,
    normalizedAt: new Date(now()).toISOString(),
    warnings: [],
    rejected: [],
    offers: 0,
    validOffers: 0,
    timestampMissing: 0,
    byChain: {},
    oldestCapturedAt: null,
    newestCapturedAt: null,
  };
  const generatedAt = toIso(raw.meta && raw.meta.generatedAt);
  if (!generatedAt) {
    report.timestampMissing += 1;
    report.warnings.push('meta.generatedAt ausente o inválido: se usa la hora de ingesta');
  }
  const fallbackTime = generatedAt || new Date(now()).toISOString();

  function warn(message) {
    if (report.warnings.length < MAX_WARNINGS) report.warnings.push(message);
  }

  function reject(label, reason) {
    report.rejected.push({ label, reason });
    warn(`${label}: ${reason}`);
  }

  function token(value, label) {
    if (value == null || value === '') return null;
    const clean = String(value).trim();
    if (!TOKEN_RE.test(clean)) {
      reject(label, 'SKU/GTIN inválido (solo letras, números, punto, guion y guion bajo)');
      return null;
    }
    return clean;
  }

  function price(value, label) {
    const number = typeof value === 'string' && value.trim() ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isFinite(number) || number <= 0) {
      reject(label, 'precio inválido (debe ser un número CLP positivo)');
      return null;
    }
    const rounded = Math.round(number);
    if (rounded !== number) warn(`${label}: precio decimal ${number} redondeado a ${rounded}`);
    return rounded;
  }

  const products = raw.products
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        reject(`products[${index}]`, 'producto no es un objeto');
        return null;
      }
      const id =
        typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `producto-${index + 1}`;
      if (!item.id) warn(`products[${index}]: id ausente, se genera ${id}`);

      const legacyPrices = item.prices && typeof item.prices === 'object' ? item.prices : {};
      const legacySkus = item.skus && typeof item.skus === 'object' ? item.skus : {};
      const sourceOffers = Array.isArray(item.offers)
        ? item.offers
        : CHAIN_IDS.filter((chain) => legacyPrices[chain] != null).map((chain) => {
            const mapping = legacySkus[chain] || {};
            return {
              chainId: chain,
              price: legacyPrices[chain],
              sku: mapping.sku,
              gtin: mapping.gtin,
              url: mapping.url,
              exact: mapping.exact,
              capturedAt: mapping.capturedAt || mapping.verifiedAt || item.capturedAt,
            };
          });

      if (sourceOffers.length > MAX_OFFERS) reject(id, `excede ${MAX_OFFERS} ofertas; se recortan`);
      const offers = [];
      for (const offer of sourceOffers.slice(0, MAX_OFFERS)) {
        if (!offer || typeof offer !== 'object') {
          reject(id, 'oferta no es un objeto');
          continue;
        }
        report.offers += 1;
        const chainId = typeof offer.chainId === 'string' ? offer.chainId.trim() : null;
        if (!CHAIN_IDS.includes(chainId)) {
          reject(`${id}/${chainId || 'sin-cadena'}`, 'cadena no reconocida');
          continue;
        }
        const amount = price(offer.price, `${id}/${chainId}`);
        if (amount == null) continue;

        const capturedAt =
          toIso(offer.capturedAt) ||
          toIso(offer.verifiedAt) ||
          toIso(item.capturedAt) ||
          fallbackTime;
        if (!toIso(offer.capturedAt) && !toIso(offer.verifiedAt) && !toIso(item.capturedAt)) {
          report.timestampMissing += 1;
          warn(`${id}/${chainId}: captura sin timestamp; se usa generatedAt del feed`);
        }
        const sku = token(offer.sku, `${id}/${chainId}/sku`);
        const gtin = token(offer.gtin, `${id}/${chainId}/gtin`);
        let url = null;
        if (offer.url != null && offer.url !== '') {
          const validated = validateUrl(offer.url, chainId);
          if (validated) url = validated;
          else reject(`${id}/${chainId}/url`, 'URL canónica rechazada por el validador');
        }

        offers.push({
          chainId,
          price: amount,
          sku,
          gtin,
          url,
          capturedAt,
          exact: (sku || gtin) && offer.exact !== false ? true : false,
        });
        report.validOffers += 1;
        report.byChain[chainId] = (report.byChain[chainId] || 0) + 1;
        if (!report.oldestCapturedAt || capturedAt < report.oldestCapturedAt)
          report.oldestCapturedAt = capturedAt;
        if (!report.newestCapturedAt || capturedAt > report.newestCapturedAt)
          report.newestCapturedAt = capturedAt;
      }

      return {
        id,
        name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id,
        detail: item.detail || item.unitLabel || '',
        description: item.description || '',
        image: item.image || null,
        category: item.category || 'Otros',
        emoji: item.emoji || '',
        unitLabel: item.unitLabel || item.detail || null,
        unitAmount: Number.isFinite(item.unitAmount) ? item.unitAmount : null,
        unitName: item.unitName || null,
        source: item.source || null,
        capturedAt: offers.length ? offers.map((o) => o.capturedAt).sort()[0] : null,
        offers,
        // Espejo del formato que consume mapDemoData(): no se inventa búsqueda por nombre.
        prices: Object.fromEntries(offers.map((o) => [o.chainId, o.price])),
        skus: Object.fromEntries(
          offers.map((o) => [
            o.chainId,
            {
              sku: o.sku,
              gtin: o.gtin,
              url: o.url,
              exact: o.exact,
              capturedAt: o.capturedAt,
            },
          ])
        ),
      };
    })
    .filter(Boolean);

  if (!report.validOffers) throw new Error('Feed sin ofertas válidas: no se publica como EN VIVO');

  const data = {
    meta: Object.assign({}, raw.meta, {
      mode: 'live',
      generatedAt: generatedAt || fallbackTime,
      feedSource: source,
    }),
    skuSearchPatterns:
      raw.skuSearchPatterns && typeof raw.skuSearchPatterns === 'object'
        ? raw.skuSearchPatterns
        : {},
    chains: raw.chains && typeof raw.chains === 'object' ? raw.chains : {},
    stores: Array.isArray(raw.stores) ? raw.stores : [],
    products,
  };
  return { data, report };
}

module.exports = {
  CHAIN_IDS,
  PAUSE_STATUSES,
  MAX_PRODUCTS,
  classifyStatus,
  parseRetryAfterMs,
  createCircuitBreaker,
  createFeedCache,
  normalizeFeed,
  toIso,
};
