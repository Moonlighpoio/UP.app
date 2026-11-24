/**
 * UP · Política de verificación de enlaces (Fase 4), sin dependencias externas.
 * ---------------------------------------------------------------------------
 * robots.txt se lee ANTES de tocar una ficha; un 403/429 es una PAUSA, nunca
 * un enlace roto y jamás se evade. Todas las funciones aceptan dependencias
 * inyectadas (fetch/now/sleep/random) para ser deterministas en tests.
 */
const { parseRetryAfterMs } = require('./feed.js');

const USER_AGENT = 'UP-Prototype/1.0 (feed autorizado; +info: README)';
const MIN_REQUEST_INTERVAL_MS = 1500; // 1 petición / 1,5 s por dominio (+ jitter ≤ 30%).
const MAX_REQUEST_INTERVAL_MS = 2000;
const ROBOTS_TTL_MS = 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8000;
const PAUSE_STATUSES = new Set([403, 429]);

/** Analiza los grupos de robots.txt; `*` y el token del UA pueden competir. */
function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [], crawlDelayMs: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (field === 'allow' || field === 'disallow')) {
      current.rules.push({ type: field, path: value });
    } else if (current && field === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelayMs = seconds * 1000;
    }
  }
  return { groups };
}

function userAgentToken(userAgent) {
  return String(userAgent || USER_AGENT)
    .split('/')[0]
    .trim()
    .toLowerCase();
}

function groupFor(robots, userAgent) {
  const token = userAgentToken(userAgent);
  let best = null;
  let bestScore = -1;
  for (const group of robots?.groups || []) {
    let score = 0;
    if (group.agents.includes(token)) score = 2;
    else if (group.agents.includes('*')) score = 1;
    else continue;
    if (score > bestScore) {
      best = group;
      bestScore = score;
    }
  }
  return best;
}

function ruleMatcher(path) {
  if (path === '') return null; // Disallow: vacío no restringe.
  // `?` es literal en robots.txt; escaparlo evita que `*?*?` se vuelva regex y bloquee todo.
  const escaped = path.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped);
}

/** Regla más específica gana; en empate prevalece Allow. */
function robotsAllows(robots, url, { userAgent = USER_AGENT } = {}) {
  if (!robots || !Array.isArray(robots.groups) || !robots.groups.length) return true;
  const group = groupFor(robots, userAgent);
  if (!group) return true;
  let target;
  try {
    const parsed = new URL(url);
    target = parsed.pathname + parsed.search;
  } catch {
    return false;
  }
  let winner = { length: -1, type: 'allow' };
  for (const rule of group.rules) {
    const matcher = ruleMatcher(rule.path);
    if (!matcher || !matcher.test(target)) continue;
    if (
      rule.path.length > winner.length ||
      (rule.path.length === winner.length && rule.type === 'allow')
    ) {
      winner = { length: rule.path.length, type: rule.type };
    }
  }
  return winner.type !== 'disallow';
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function header(res, name) {
  if (!res || typeof res.headers?.get !== 'function') return null;
  return res.headers.get(name);
}

/**
 * Guardián de robots.txt por origen. Cachea el documento, no la decisión de
 * una URL concreta, para no reutilizar un Allow de otra ruta.
 */
function createRobotsGuard({ ttlMs = ROBOTS_TTL_MS, cache = new Map() } = {}) {
  async function check(targetUrl, deps = {}) {
    const now = deps.now || Date.now;
    const doFetch = deps.fetch || fetch;
    const userAgent = deps.userAgent || USER_AGENT;
    const origin = originOf(targetUrl);
    if (!origin) {
      return {
        allowed: false,
        status: 0,
        error: 'URL inválida',
        checkedAt: new Date(now()).toISOString(),
      };
    }
    const cached = cache.get(origin);
    if (cached && now() - cached.at < ttlMs) {
      return {
        ...cached.value,
        allowed: cached.value.robots
          ? robotsAllows(cached.value.robots, targetUrl, { userAgent })
          : false,
        cached: true,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs || DEFAULT_TIMEOUT_MS);
    let value;
    try {
      const res = await doFetch(`${origin}/robots.txt`, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': userAgent, Accept: 'text/plain,*/*' },
        signal: controller.signal,
      });
      const status = res.status;
      if (PAUSE_STATUSES.has(status)) {
        value = {
          allowed: false,
          paused: true,
          status,
          error: `robots.txt bloqueó la verificación (HTTP ${status}); no se marca enlace roto`,
          retryAfterMs: parseRetryAfterMs(header(res, 'retry-after'), now),
          robotsUrl: `${origin}/robots.txt`,
        };
      } else if (status === 404) {
        value = {
          allowed: true,
          paused: false,
          status,
          robots: parseRobots(''),
          crawlDelayMs: null,
          robotsUrl: `${origin}/robots.txt`,
        };
      } else if (status >= 200 && status < 300) {
        const text = typeof res.text === 'function' ? await res.text() : '';
        const robots = parseRobots(text);
        const group = groupFor(robots, userAgent);
        value = {
          allowed: robotsAllows(robots, targetUrl, { userAgent }),
          paused: false,
          status,
          robots,
          crawlDelayMs: group?.crawlDelayMs ?? null,
          robotsUrl: `${origin}/robots.txt`,
        };
      } else {
        value = {
          allowed: false,
          paused: status === 429,
          status,
          error: `robots.txt no utilizable (HTTP ${status}); verificación omitida`,
          robotsUrl: `${origin}/robots.txt`,
        };
      }
    } catch (err) {
      value = {
        allowed: false,
        paused: true,
        status: 0,
        error: `No se pudo leer robots.txt: ${err.message}`,
        robotsUrl: `${origin}/robots.txt`,
      };
    } finally {
      clearTimeout(timer);
    }
    value.checkedAt = new Date(now()).toISOString();
    cache.set(origin, { value, at: now() });
    return value;
  }
  check.reset = () => cache.clear();
  return { check, reset: check.reset };
}

/** Espacia peticiones por dominio y respeta Crawl-delay cuando es mayor. */
function createDomainThrottle({
  minIntervalMs = MIN_REQUEST_INTERVAL_MS,
  maxIntervalMs = MAX_REQUEST_INTERVAL_MS,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
} = {}) {
  const last = new Map();
  return {
    async wait(origin, crawlDelayMs = 0) {
      if (!origin) return 0;
      const base = Math.max(minIntervalMs, Number(crawlDelayMs) || 0);
      // Si Crawl-delay ya exige >2 s, se respeta sin añadir jitter.
      const jitterRange = base >= maxIntervalMs ? 0 : maxIntervalMs - base;
      const jitter = Math.min(jitterRange, Math.floor(random() * (jitterRange + 1)));
      const interval = base + jitter;
      const previous = last.get(origin);
      const waitMs = previous == null ? 0 : Math.max(0, previous + interval - now());
      if (waitMs) await sleep(waitMs);
      last.set(origin, now());
      return waitMs;
    },
    reset() {
      last.clear();
    },
  };
}

/** Reintentos con jitter para fallos transitorios; 403/429 se pausan, no se reintentan. */
function backoffWithJitter(attempt, { baseMs = 1000, maxMs = 30_000, random = Math.random } = {}) {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(exponential * (1 + random() * 0.3));
}

/** Cabeceras condicionales para no transferir una ficha sin cambios. */
function conditionalHeaders(etag, lastModified) {
  return {
    ...(etag ? { 'If-None-Match': etag } : {}),
    ...(lastModified ? { 'If-Modified-Since': lastModified } : {}),
  };
}

/** Traduce un resultado de verificación a estado de url_queue, sin tocar precios. */
function urlQueueStatus(result) {
  if (result.paused || result.robotsPaused) return 'paused';
  if (result.ok) return 'verified';
  if ([404, 410].includes(result.status)) return 'broken';
  return 'unavailable';
}

module.exports = {
  USER_AGENT,
  MIN_REQUEST_INTERVAL_MS,
  MAX_REQUEST_INTERVAL_MS,
  ROBOTS_TTL_MS,
  parseRobots,
  robotsAllows,
  groupFor,
  originOf,
  createRobotsGuard,
  createDomainThrottle,
  backoffWithJitter,
  conditionalHeaders,
  urlQueueStatus,
};
