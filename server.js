/**
 * UP · Servidor del prototipo (Node.js, sin dependencias)
 * ---------------------------------------------------------------------------
 *   npm start
 *   → http://localhost:3100
 *
 * Endpoints:
 *   GET /api/prices?q=coca                    → JSON con { meta, chains, stores, products }
 *   GET /api/verify-link?url=https://...      → verifica que la ficha externa siga vigente
 *
 * Orden de prioridad para /api/prices:
 *   1) UP_RETAILER_API=https://tu-api-de-supermercados/precios
 *   2) data/live-prices.json (si existe)
 *   3) data/catalog.sqlite (modo demostración; Fase 2)
 *
 * Fase 2: la fuente de verdad es SQLite. data/catalog.json y data/demo.js son
 * artefactos derivados: Pages sigue funcionando sin servidor ni SQLite.
 * Fase 9: feeds autorizados únicamente. Normalización con SKU/GTIN + URL
 * canónica + precio + timestamp, caché con TTL y circuit breakers. Un 403/429
 * PAUSA el conector; nunca se interpreta como "producto no existe" ni se evade.
 *
 * Seguridad: sirve solo archivos dentro de esta carpeta (sin path traversal),
 * valida cada salto de redirección, limita peticiones por IP y envía headers
 * de seguridad en TODAS las respuestas.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { readCatalogPayload } = require('./scripts/catalog-db.js');
const {
  CHAIN_IDS,
  PAUSE_STATUSES,
  classifyStatus,
  parseRetryAfterMs,
  createCircuitBreaker,
  createFeedCache,
  normalizeFeed,
} = require('./lib/feed.js');
const {
  createRobotsGuard,
  createDomainThrottle,
  conditionalHeaders,
  originOf,
  backoffWithJitter,
} = require('./lib/link-policy.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3100);
const DEMO_SOURCE = 'data/catalog.sqlite';

// Verificación de enlaces: solo dominios de supermercados permitidos (evita SSRF).
// El mismo mapa permite Derivar la cadena de un host para el circuit breaker.
const LINK_DOMAINS = {
  lider: ['lider.cl'],
  jumbo: ['jumbo.cl'],
  santaisabel: ['santaisabel.cl'],
  tottus: ['tottus.cl'],
  unimarc: ['unimarc.cl'],
  coope: ['coope.cl'],
};
const LINK_ALLOWLIST = Object.values(LINK_DOMAINS).flat();
const LINK_CACHE_MS = 5 * 60 * 1000;
const linkCache = new Map();
const UA = 'UP-Prototype/1.0 (feed autorizado; +info: README)';
const linkRobots = createRobotsGuard();
const linkThrottle = createDomainThrottle();

// Integración de datos: TTL y pausa configurable por entorno, sin dependencias nuevas.
const FEED_SCHEMA_VERSION = '2026-11-24';
const FEED_TTL_MS = positiveInt(process.env.UP_FEED_TTL_MS, 15 * 60 * 1000);
const FEED_BREAKER_THRESHOLD = positiveInt(process.env.UP_FEED_BREAKER_THRESHOLD, 3);
const FEED_BREAKER_COOLDOWN_MS = positiveInt(process.env.UP_FEED_BREAKER_COOLDOWN_MS, 60_000);
const UPSTREAM_KEY = 'upstream';
const DATA_POLICY =
  'Solo feeds/APIs autorizados. URL canónica o búsqueda exacta por SKU/GTIN; nunca por nombre. ' +
  '403/429 pausa el conector y requiere renegociar acceso.';

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function chainForUrl(raw) {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
    const entry = Object.entries(LINK_DOMAINS).find(([, domains]) =>
      domains.some((domain) => host === domain || host.endsWith('.' + domain))
    );
    return entry ? entry[0] : null;
  } catch {
    return null;
  }
}

const upstreamBreaker = createCircuitBreaker({
  threshold: FEED_BREAKER_THRESHOLD,
  cooldownMs: FEED_BREAKER_COOLDOWN_MS,
});
const linkBreaker = createCircuitBreaker({
  threshold: FEED_BREAKER_THRESHOLD,
  cooldownMs: FEED_BREAKER_COOLDOWN_MS,
});
const feedCache = createFeedCache({ ttlMs: FEED_TTL_MS });

// Un solo timeout para TODAS las salidas de red (feed externo + verificación).
const NETWORK_TIMEOUT_MS = 8000;
// Nunca seguir redirecciones automáticamente: se valida cada salto contra la whitelist.
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HEAD_RETRY_STATUSES = new Set([403, 405, 501]);

// Rate limiting en memoria por IP. No se confía en X-Forwarded-For (spoofable).
const VERIFY_RATE = { limit: 10, windowMs: 60_000 };
const PRICES_RATE = { limit: 60, windowMs: 60_000 };

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ].join('; '),
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

function readDemo() {
  // Mantiene el contrato histórico de data/demo.js, pero leyendo la BD canónica.
  // data/demo.js queda como artefacto estático para GitHub Pages.
  return readCatalogPayload();
}

function buildMeta(data, ctx, deps) {
  const now = (deps.now || Date.now)();
  const generatedAt = data.meta && data.meta.generatedAt ? data.meta.generatedAt : null;
  const capturedAt = ctx.report ? ctx.report.newestCapturedAt : null;
  const ageOf = (iso) => {
    const time = Date.parse(iso || '');
    return Number.isFinite(time) ? Math.max(0, now - time) : null;
  };
  const ages = [ageOf(generatedAt), ageOf(capturedAt)].filter((value) => value != null);
  const ageMs = ages.length ? Math.max(...ages) : null;
  const stampMissing = ctx.report ? ctx.report.timestampMissing > 0 : false;
  const stale =
    ctx.mode === 'live' &&
    (ctx.stale || stampMissing || (ageMs != null && ageMs > (deps.cache || feedCache).ttlMs));

  return Object.assign({}, data, {
    meta: Object.assign({}, data.meta, {
      mode: ctx.mode,
      source: ctx.source,
      generatedAt: generatedAt || null,
      capturedAt: capturedAt || null,
      ageSeconds: ctx.mode !== 'live' || ageMs == null ? null : Math.round(ageMs / 1000),
      stale,
      query: ctx.query || null,
      feedVersion: FEED_SCHEMA_VERSION,
      dataPolicy: DATA_POLICY,
      integration: {
        ttlMs: (deps.cache || feedCache).ttlMs,
        policy: DATA_POLICY,
        warnings: ctx.warnings || [],
        fallbackReason: ctx.fallbackReason || null,
        report: ctx.report || null,
        cache: (deps.cache || feedCache).snapshot(),
        breakers: {
          upstream: (deps.breaker || upstreamBreaker).snapshot(),
          links: (deps.linkBreaker || linkBreaker).snapshot(),
        },
      },
    }),
  });
}

function cachedResult(cached, source, reason, warnings) {
  warnings.push(reason);
  return {
    data: cached.data,
    report: cached.report,
    mode: 'live',
    source,
    stale: true,
    fallbackReason: reason,
  };
}

async function loadUpstream(source, query, ctx, deps) {
  const cache = deps.cache || feedCache;
  const breaker = deps.breaker || upstreamBreaker;
  const now = deps.now || Date.now;
  const doFetch = deps.fetch || fetch;
  const key = 'upstream:' + source;
  const cached = cache.get(key);

  if (cached && !cached.stale) {
    return { data: cached.data, report: cached.report, mode: 'live', source, stale: false };
  }
  if (!breaker.allow(UPSTREAM_KEY)) {
    if (cached)
      return cachedResult(
        cached,
        source,
        'API externa en pausa (circuit breaker): se sirve caché',
        ctx.warnings
      );
    ctx.warnings.push('API externa en pausa (circuit breaker): se usa el siguiente origen');
    return null;
  }

  const url = source + (source.includes('?') ? '&' : '?') + 'q=' + encodeURIComponent(query || '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const res = await doFetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': UA },
    });
    const status = Number(res && res.status) || 0;
    if (classifyStatus(status) === 'pause') {
      const header =
        res.headers && typeof res.headers.get === 'function'
          ? res.headers.get('retry-after')
          : null;
      breaker.recordFailure(UPSTREAM_KEY, parseRetryAfterMs(header, now));
      const reason = `API externa pausada por HTTP ${status}: se reanuda tras el enfriamiento`;
      console.warn('[UP]', reason);
      if (cached) return cachedResult(cached, source, reason, ctx.warnings);
      ctx.warnings.push(reason);
      return null;
    }
    // La ausencia de bloqueo es éxito para el breaker: disponibilidad es otra señal.
    breaker.recordSuccess(UPSTREAM_KEY);
    if (!res.ok) throw new Error('Upstream HTTP ' + status);
    const normalized = normalizeFeed(await res.json(), {
      now,
      source,
      validateUrl: allowedLink,
    });
    cache.set(key, normalized.data, normalized.report);
    return {
      data: normalized.data,
      report: normalized.report,
      mode: 'live',
      source,
      stale: false,
    };
  } catch (err) {
    ctx.warnings.push('API externa no disponible: ' + err.message);
    if (cached)
      return cachedResult(
        cached,
        source,
        'No se pudo refrescar la API externa: se sirve caché',
        ctx.warnings
      );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function loadLocalFeed(ctx, deps) {
  const cache = deps.cache || feedCache;
  const now = deps.now || Date.now;
  const exists = deps.existsSync || fs.existsSync;
  const read = deps.readFileSync || fs.readFileSync;
  const file = path.join(ROOT, 'data', 'live-prices.json');
  const source = 'data/live-prices.json';
  const key = 'file:' + source;
  const cached = cache.get(key);
  if (cached && !cached.stale) {
    return { data: cached.data, report: cached.report, mode: 'live', source, stale: false };
  }
  if (!exists(file)) {
    if (cached)
      return cachedResult(cached, source, 'Feed local ya no existe: se sirve caché', ctx.warnings);
    return null;
  }
  try {
    const normalized = normalizeFeed(JSON.parse(read(file, 'utf8')), {
      now,
      source,
      validateUrl: allowedLink,
    });
    cache.set(key, normalized.data, normalized.report);
    return {
      data: normalized.data,
      report: normalized.report,
      mode: 'live',
      source,
      stale: false,
    };
  } catch (err) {
    ctx.warnings.push('Feed local inválido: ' + err.message);
    if (cached)
      return cachedResult(cached, source, 'Feed local inválido: se sirve caché', ctx.warnings);
    return null;
  }
}

async function getPrices(query, deps = {}) {
  const ctx = { warnings: [] };
  const env = deps.env || process.env;
  const upstream = deps.upstream !== undefined ? deps.upstream : env.UP_RETAILER_API;
  const fromApi = upstream ? await loadUpstream(upstream, query, ctx, deps) : null;
  const live = fromApi || loadLocalFeed(ctx, deps);
  if (live) return buildMeta(live.data, Object.assign({}, ctx, live, { query }), deps);

  const demo = deps.readDemo ? deps.readDemo() : readDemo();
  demo.meta = Object.assign({}, demo.meta, {
    mode: 'demo',
    source: DEMO_SOURCE,
    query: query || null,
  });
  return buildMeta(
    demo,
    {
      mode: 'demo',
      source: DEMO_SOURCE,
      query,
      stale: false,
      warnings: ctx.warnings,
      fallbackReason: ctx.warnings.length
        ? 'Fuentes EN VIVO no disponibles'
        : 'Sin feed configurado (data/live-prices.json ni UP_RETAILER_API)',
    },
    deps
  );
}

function allowedLink(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  const host = parsed.hostname.toLowerCase();
  const ok = LINK_ALLOWLIST.some((domain) => host === domain || host.endsWith('.' + domain));
  return ok ? parsed.toString() : null;
}

/** Colas de espera/control de acceso: se pausa antes de contactar el destino. */
function isAccessQueueRedirect(url) {
  try {
    const parsed = new URL(url);
    return /queue/i.test(parsed.hostname + parsed.pathname);
  } catch {
    return false;
  }
}

function createRateLimiter({ limit, windowMs, now = Date.now } = {}) {
  const hits = new Map();
  const check = (key) => {
    const t = now();
    let entry = hits.get(key);
    if (!entry || t - entry.start >= windowMs) {
      entry = { start: t, count: 0 };
      hits.set(key, entry);
    }
    entry.count += 1;
    return {
      allowed: entry.count <= limit,
      remaining: Math.max(0, limit - entry.count),
      retryAfter: Math.max(1, Math.ceil((entry.start + windowMs - t) / 1000)),
    };
  };
  check.reset = () => hits.clear();
  return check;
}

const checkVerifyRate = createRateLimiter(VERIFY_RATE);
const checkPricesRate = createRateLimiter(PRICES_RATE);

// Solo para tests: deja el limitador en estado inicial entre suites.
function resetRateLimits() {
  checkVerifyRate.reset();
  checkPricesRate.reset();
}

// Solo para tests: deja caché y circuit breakers en estado inicial.
function resetIntegrationState() {
  feedCache.reset();
  upstreamBreaker.reset();
  linkBreaker.reset();
  linkRobots.reset();
  linkThrottle.reset();
}

function clientIp(req) {
  // X-Forwarded-For es spoofable si el servidor está expuesto directamente.
  return req.socket.remoteAddress || 'unknown';
}

function rateLimited(res, check, req) {
  const result = check(clientIp(req));
  if (result.allowed) return false;
  res.setHeader('Retry-After', String(result.retryAfter));
  send(
    res,
    429,
    JSON.stringify({
      ok: false,
      paused: true,
      error: 'Demasiadas solicitudes',
      retryAfter: result.retryAfter,
    })
  );
  return true;
}

function responseHeader(res, name) {
  return res?.headers && typeof res.headers.get === 'function' ? res.headers.get(name) : null;
}

/** Retry-After si viene; si no, backoff exponencial con jitter según fallos previos. */
function pauseRetryMs(breaker, chain, headerValue, now) {
  const parsed = parseRetryAfterMs(headerValue, now);
  if (Number.isFinite(parsed)) return parsed;
  let failures = 0;
  if (chain && typeof breaker.snapshot === 'function') {
    failures = breaker.snapshot()[chain]?.failures || 0;
  }
  return backoffWithJitter(failures);
}

function redirectLocation(res, currentUrl) {
  const location = responseHeader(res, 'location');
  if (!location) return null;
  try {
    return new URL(location, currentUrl).toString();
  } catch {
    return null;
  }
}

async function fetchRedirectSafe(doFetch, url, signal, extraHeaders = {}) {
  const options = {
    method: 'HEAD',
    redirect: 'manual',
    signal,
    headers: { 'User-Agent': UA, ...extraHeaders },
  };
  let res = await doFetch(url, options);
  // Algunos sites responden 403/405/501 al HEAD; se reintenta con GET.
  if (HEAD_RETRY_STATUSES.has(res.status)) {
    res = await doFetch(url, Object.assign({}, options, { method: 'GET' }));
  }
  return res;
}

async function verifyLink(raw, deps = {}) {
  const doFetch = deps.fetch || fetch;
  const now = deps.now || Date.now;
  const cache = deps.cache || linkCache;
  const breaker = deps.breaker || linkBreaker;
  const cacheKey = allowedLink(raw);
  if (!cacheKey) {
    return {
      ok: false,
      status: 0,
      error: 'Dominio no permitido',
      checkedAt: new Date(now()).toISOString(),
    };
  }
  const chain = deps.chain || chainForUrl(cacheKey);

  const cached = cache.get(cacheKey);
  if (cached && now() - cached.at < LINK_CACHE_MS) {
    return Object.assign({}, cached.payload, { cached: true });
  }

  if (chain && !breaker.allow(chain)) {
    const state = breaker.snapshot()[chain] || {};
    const seconds = Math.ceil((state.nextRetryInMs || 0) / 1000);
    return {
      ok: false,
      status: 0,
      chain,
      paused: true,
      error: `Verificación pausada para ${chain} por 403/429 previos. Reintento en ${seconds} s`,
      checkedAt: new Date(now()).toISOString(),
    };
  }

  // Toda petición de red (robots, HEAD, GET y cada salto) pasa por el mismo
  // espaciador por dominio: máximo una cada 1–2 s, con Crawl-delay si aplica.
  const throttle = deps.throttle || linkThrottle;
  let crawlDelayMs = 0;
  const pacedFetch = async (url, options) => {
    await throttle.wait(originOf(url), crawlDelayMs);
    return doFetch(url, options);
  };

  // robots.txt se consulta ANTES de la ficha. 403/429 o una regla Disallow
  // pausan la verificación: nunca se interpreta como enlace roto ni se evade.
  const robotsGuard = deps.robotsGuard || linkRobots;
  const robots = deps.robots || (await robotsGuard.check(cacheKey, { fetch: pacedFetch, now }));
  const robotsMeta = {
    robotsStatus: robots.allowed ? 'allowed' : 'paused',
    robotsUrl: robots.robotsUrl || null,
    robotsCheckedAt: robots.checkedAt || null,
  };
  if (!robots.allowed) {
    let path = '';
    try {
      path = new URL(cacheKey).pathname;
    } catch {
      path = cacheKey;
    }
    return {
      ok: false,
      status: robots.status || 0,
      chain,
      paused: true,
      robotsPaused: true,
      error: robots.error || `robots.txt desautoriza ${path}; verificación omitida`,
      checkedAt: new Date(now()).toISOString(),
      ...robotsMeta,
      retryAfterMs: robots.retryAfterMs || null,
    };
  }

  crawlDelayMs = robots.crawlDelayMs || 0;
  const conditional =
    deps.conditional || conditionalHeaders(deps.etag, deps.lastModified);

  let currentUrl = cacheKey;
  let hops = 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    while (true) {
      const res = await fetchRedirectSafe(pacedFetch, currentUrl, controller.signal, conditional);
      if (res.status === 304) {
        if (chain) breaker.recordSuccess(chain);
        const payload = {
          ok: true,
          status: 304,
          notModified: true,
          finalUrl: currentUrl,
          hops,
          etag: responseHeader(res, 'etag') || deps.etag || null,
          lastModified: responseHeader(res, 'last-modified') || deps.lastModified || null,
          checkedAt: new Date(now()).toISOString(),
          ...robotsMeta,
        };
        cache.set(cacheKey, { payload, at: now() });
        return payload;
      }
      if (PAUSE_STATUSES.has(res.status)) {
        const header = responseHeader(res, 'retry-after');
        const retryMs = pauseRetryMs(breaker, chain, header, now);
        if (chain) breaker.recordFailure(chain, retryMs);
        return {
          ok: false,
          status: res.status,
          chain,
          paused: true,
          error: `Acceso pausado por ${chain || 'la cadena'} (HTTP ${res.status}); no se marca enlace roto`,
          finalUrl: currentUrl,
          checkedAt: new Date(now()).toISOString(),
          retryAfterMs: retryMs,
        };
      }
      if (REDIRECT_STATUSES.has(res.status)) {
        const next = redirectLocation(res, currentUrl);
        if (!next) {
          return {
            ok: false,
            status: res.status,
            error: 'Redirección sin destino válido',
            finalUrl: currentUrl,
            checkedAt: new Date(now()).toISOString(),
          };
        }
        if (isAccessQueueRedirect(next)) {
          return {
            ok: false,
            status: res.status,
            chain,
            paused: true,
            error: 'Redirección a cola de espera/control de acceso; verificación pausada, sin evasión',
            finalUrl: next,
            checkedAt: new Date(now()).toISOString(),
          };
        }
        const validated = allowedLink(next);
        // Se rechaza ANTES de contactar al destino: `redirect: 'manual'` evita
        // que fetch siga la redirección por detrás de esta validación.
        if (!validated) {
          return {
            ok: false,
            status: 0,
            chain,
            paused: true,
            error: 'Redirección a host no permitido',
            finalUrl: next,
            checkedAt: new Date(now()).toISOString(),
          };
        }
        hops += 1;
        if (hops > MAX_REDIRECTS) {
          return {
            ok: false,
            status: res.status,
            error: 'Demasiadas redirecciones',
            finalUrl: validated,
            checkedAt: new Date(now()).toISOString(),
          };
        }
        currentUrl = validated;
        continue;
      }

      const finalUrl = res.url || currentUrl;
      if (!allowedLink(finalUrl)) {
        return {
          ok: false,
          status: 0,
          chain,
          paused: true,
          error: 'Redirección a host no permitido',
          finalUrl,
          checkedAt: new Date(now()).toISOString(),
        };
      }
      if (chain) breaker.recordSuccess(chain);
      const payload = {
        ok: res.ok,
        status: res.status,
        finalUrl,
        hops,
        etag: responseHeader(res, 'etag'),
        lastModified: responseHeader(res, 'last-modified'),
        checkedAt: new Date(now()).toISOString(),
        ...robotsMeta,
      };
      cache.set(cacheKey, { payload, at: now() });
      return payload;
    }
  } catch (err) {
    return { ok: false, status: 0, error: err.message, checkedAt: new Date(now()).toISOString() };
  } finally {
    clearTimeout(timer);
  }
}

function send(res, status, body, type) {
  // Todas las respuestas (API, estáticos y errores) salen con los mismos headers.
  res.writeHead(
    status,
    Object.assign(
      {
        'Content-Type': type || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      SECURITY_HEADERS
    )
  );
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/prices') {
    if (rateLimited(res, checkPricesRate, req)) return;
    try {
      const json = await getPrices(url.searchParams.get('q') || '');
      return send(res, 200, JSON.stringify(json));
    } catch (err) {
      return send(res, 500, JSON.stringify({ error: err.message }));
    }
  }

  if (url.pathname === '/api/health') {
    return send(res, 200, JSON.stringify({ ok: true, service: 'UP prototipo' }));
  }

  if (url.pathname === '/api/feed-status') {
    if (rateLimited(res, checkPricesRate, req)) return;
    return send(
      res,
      200,
      JSON.stringify({
        ok: true,
        feedVersion: FEED_SCHEMA_VERSION,
        ttlMs: feedCache.ttlMs,
        dataPolicy: DATA_POLICY,
        cache: feedCache.snapshot(),
        breakers: {
          upstream: upstreamBreaker.snapshot(),
          links: linkBreaker.snapshot(),
        },
      })
    );
  }

  if (url.pathname === '/api/verify-link') {
    if (rateLimited(res, checkVerifyRate, req)) return;
    const result = await verifyLink(url.searchParams.get('url') || '');
    return send(res, 200, JSON.stringify(result));
  }

  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = path.resolve(ROOT, '.' + rel);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, 'index.html')) {
    return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  }
  // La BD es fuente interna: nunca se sirve como archivo estático.
  if (path.extname(filePath).toLowerCase() === '.sqlite') {
    return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    send(res, 200, data, MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n  UP · Prototipo corriendo en http://localhost:${PORT}`);
    console.log(
      '  Modo datos: ' +
        (process.env.UP_RETAILER_API
          ? 'API externa (' + process.env.UP_RETAILER_API + ')'
          : fs.existsSync(path.join(ROOT, 'data', 'live-prices.json'))
            ? 'live-prices.json'
            : 'catalog.sqlite (demo)')
    );
    console.log(
      '  TTL de feed: ' +
        Math.round(FEED_TTL_MS / 1000) +
        ' s · pausa 403/429 tras ' +
        FEED_BREAKER_THRESHOLD +
        ' fallos'
    );
    console.log('  Presiona Ctrl+C para detener.\n');
  });
}

module.exports = {
  server,
  getPrices,
  allowedLink,
  verifyLink,
  createRateLimiter,
  resetRateLimits,
  resetIntegrationState,
  chainForUrl,
  FEED_TTL_MS,
  FEED_SCHEMA_VERSION,
  FEED_BREAKER_THRESHOLD,
  FEED_BREAKER_COOLDOWN_MS,
  // Re-exportados para una sola superficie de tests.
  CHAIN_IDS,
  PAUSE_STATUSES,
  classifyStatus,
  parseRetryAfterMs,
  createCircuitBreaker,
  createFeedCache,
  normalizeFeed,
  VERIFY_RATE,
  PRICES_RATE,
  NETWORK_TIMEOUT_MS,
  MAX_REDIRECTS,
  SECURITY_HEADERS,
  LINK_ALLOWLIST,
  LINK_CACHE_MS,
};
