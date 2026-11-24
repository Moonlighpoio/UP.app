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
 * Seguridad: sirve solo archivos dentro de esta carpeta (sin path traversal).
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
      const timer = setTimeout(() => controller.abort(), 6000);
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
  try { parsed = new URL(raw); } catch (_) { return null; }
  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  const host = parsed.hostname.toLowerCase();
  const ok = LINK_ALLOWLIST.some((domain) => host === domain || host.endsWith("." + domain));
  return ok ? parsed.toString() : null;
}

async function verifyLink(raw) {
  const url = allowedLink(raw);
  if (!url) return { ok: false, status: 0, error: "Dominio no permitido", checkedAt: new Date().toISOString() };

  const cached = linkCache.get(url);
  if (cached && Date.now() - cached.at < LINK_CACHE_MS) {
    return Object.assign({}, cached.payload, { cached: true });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal, headers: { "User-Agent": UA } });
    // Algunos sites responden 403/405 al HEAD; se reintenta con GET.
    if ([403, 405, 501].includes(res.status)) {
      res = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal, headers: { "User-Agent": UA } });
    }
    const payload = {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url,
      checkedAt: new Date().toISOString()
    };
    linkCache.set(url, { payload, at: Date.now() });
    return payload;
  } catch (err) {
    return { ok: false, status: 0, error: err.message, checkedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timer);
  }
}

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type || "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/prices") {
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

server.listen(PORT, () => {
  console.log(`\n  UP · Prototipo corriendo en http://localhost:${PORT}`);
  console.log("  Modo datos: " + (process.env.UP_RETAILER_API
    ? "API externa (" + process.env.UP_RETAILER_API + ")"
    : fs.existsSync(path.join(ROOT, "data", "live-prices.json")) ? "live-prices.json" : "demo"));
  console.log("  Presiona Ctrl+C para detener.\n");
});
