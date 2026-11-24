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
 *   3) data/demo.js (modo demostración)
 *
 * Seguridad: sirve solo archivos dentro de esta carpeta (sin path traversal),
 * valida cada salto de redirección, limita peticiones por IP y envía headers
 * de seguridad en TODAS las respuestas.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3100);

// Verificación de enlaces: solo dominios de supermercados permitidos (evita SSRF).
const LINK_ALLOWLIST = ["jumbo.cl", "lider.cl", "tottus.cl", "unimarc.cl", "santaisabel.cl", "coope.cl"];
const LINK_CACHE_MS = 5 * 60 * 1000;
const linkCache = new Map();
const UA = "Mozilla/5.0 (compatible; UP-Prototype/1.0; +verificacion-local)";

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
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' https://cdn.tailwindcss.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'"
  ].join("; ")
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8"
};

function readDemo() {
  // demo.js es un literal JS (claves sin comillas), no JSON estricto.
  // Se evalúa en un contexto aislado con un `window` propio.
  const raw = fs.readFileSync(path.join(ROOT, "data", "demo.js"), "utf8");
  const ctx = { window: {} };
  vm.runInNewContext(raw, ctx, { timeout: 1000 });
  return ctx.window.UP_DEMO_DATA;
}

async function getPrices(query) {
  const upstream = process.env.UP_RETAILER_API;
  if (upstream) {
    try {
      const url = upstream + (upstream.includes("?") ? "&" : "?") + "q=" + encodeURIComponent(query || "");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      clearTimeout(timer);
      if (!res.ok) throw new Error("Upstream HTTP " + res.status);
      const json = await res.json();
      json.meta = Object.assign({}, json.meta, { mode: "live", source: upstream });
      return json;
    } catch (err) {
      console.warn("[UP] API externa no disponible:", err.message, "→ usando fallback local");
    }
  }

  const liveFile = path.join(ROOT, "data", "live-prices.json");
  if (fs.existsSync(liveFile)) {
    const json = JSON.parse(fs.readFileSync(liveFile, "utf8"));
    json.meta = Object.assign({ mode: "live", source: "data/live-prices.json" }, json.meta);
    return json;
  }

  const demo = readDemo();
  demo.meta = Object.assign({}, demo.meta, { mode: "demo", query: query || null });
  return demo;
}

function allowedLink(raw) {
  let parsed;
  try { parsed = new URL(raw); } catch { return null; }
  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  const host = parsed.hostname.toLowerCase();
  const ok = LINK_ALLOWLIST.some((domain) => host === domain || host.endsWith("." + domain));
  return ok ? parsed.toString() : null;
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
      retryAfter: Math.max(1, Math.ceil((entry.start + windowMs - t) / 1000))
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

function clientIp(req) {
  // X-Forwarded-For es spoofable si el servidor está expuesto directamente.
  return req.socket.remoteAddress || "unknown";
}

function rateLimited(res, check, req) {
  const result = check(clientIp(req));
  if (result.allowed) return false;
  res.setHeader("Retry-After", String(result.retryAfter));
  send(res, 429, JSON.stringify({ error: "Demasiadas solicitudes", retryAfter: result.retryAfter }));
  return true;
}

function redirectLocation(res, currentUrl) {
  const location = res.headers && typeof res.headers.get === "function" ? res.headers.get("location") : null;
  if (!location) return null;
  try {
    return new URL(location, currentUrl).toString();
  } catch {
    return null;
  }
}

async function fetchRedirectSafe(doFetch, url, signal) {
  const options = { method: "HEAD", redirect: "manual", signal, headers: { "User-Agent": UA } };
  let res = await doFetch(url, options);
  // Algunos sites responden 403/405/501 al HEAD; se reintenta con GET.
  if (HEAD_RETRY_STATUSES.has(res.status)) {
    res = await doFetch(url, Object.assign({}, options, { method: "GET" }));
  }
  return res;
}

async function verifyLink(raw, deps = {}) {
  const doFetch = deps.fetch || fetch;
  const now = deps.now || Date.now;
  const cache = deps.cache || linkCache;
  const cacheKey = allowedLink(raw);
  if (!cacheKey) {
    return { ok: false, status: 0, error: "Dominio no permitido", checkedAt: new Date(now()).toISOString() };
  }

  const cached = cache.get(cacheKey);
  if (cached && now() - cached.at < LINK_CACHE_MS) {
    return Object.assign({}, cached.payload, { cached: true });
  }

  let currentUrl = cacheKey;
  let hops = 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    while (true) {
      const res = await fetchRedirectSafe(doFetch, currentUrl, controller.signal);
      if (REDIRECT_STATUSES.has(res.status)) {
        const next = redirectLocation(res, currentUrl);
        if (!next) {
          return { ok: false, status: res.status, error: "Redirección sin destino válido", finalUrl: currentUrl, checkedAt: new Date(now()).toISOString() };
        }
        const validated = allowedLink(next);
        // Se rechaza ANTES de contactar al destino: `redirect: 'manual'` evita
        // que fetch siga la redirección por detrás de esta validación.
        if (!validated) {
          return { ok: false, status: 0, error: "Redirección a host no permitido", finalUrl: next, checkedAt: new Date(now()).toISOString() };
        }
        hops += 1;
        if (hops > MAX_REDIRECTS) {
          return { ok: false, status: res.status, error: "Demasiadas redirecciones", finalUrl: validated, checkedAt: new Date(now()).toISOString() };
        }
        currentUrl = validated;
        continue;
      }

      const finalUrl = res.url || currentUrl;
      if (!allowedLink(finalUrl)) {
        return { ok: false, status: 0, error: "Redirección a host no permitido", finalUrl, checkedAt: new Date(now()).toISOString() };
      }
      const payload = {
        ok: res.ok,
        status: res.status,
        finalUrl,
        hops,
        checkedAt: new Date(now()).toISOString()
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
        "Content-Type": type || "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      },
      SECURITY_HEADERS
    )
  );
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/prices") {
    if (rateLimited(res, checkPricesRate, req)) return;
    try {
      const json = await getPrices(url.searchParams.get("q") || "");
      return send(res, 200, JSON.stringify(json));
    } catch (err) {
      return send(res, 500, JSON.stringify({ error: err.message }));
    }
  }

  if (url.pathname === "/api/health") {
    return send(res, 200, JSON.stringify({ ok: true, service: "UP prototipo" }));
  }

  if (url.pathname === "/api/verify-link") {
    if (rateLimited(res, checkVerifyRate, req)) return;
    const result = await verifyLink(url.searchParams.get("url") || "");
    return send(res, 200, JSON.stringify(result));
  }

  const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.resolve(ROOT, "." + rel);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, "index.html")) {
    return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    send(res, 200, data, MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream");
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n  UP · Prototipo corriendo en http://localhost:${PORT}`);
    console.log("  Modo datos: " + (process.env.UP_RETAILER_API
      ? "API externa (" + process.env.UP_RETAILER_API + ")"
      : fs.existsSync(path.join(ROOT, "data", "live-prices.json")) ? "live-prices.json" : "demo"));
    console.log("  Presiona Ctrl+C para detener.\n");
  });
}

module.exports = {
  server,
  getPrices,
  allowedLink,
  verifyLink,
  createRateLimiter,
  resetRateLimits,
  VERIFY_RATE,
  PRICES_RATE,
  NETWORK_TIMEOUT_MS,
  MAX_REDIRECTS,
  SECURITY_HEADERS,
  LINK_ALLOWLIST,
  LINK_CACHE_MS
};
