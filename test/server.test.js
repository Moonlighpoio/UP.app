import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  server,
  allowedLink,
  verifyLink,
  createRateLimiter,
  resetRateLimits,
  resetAdminRate,
  VERIFY_RATE,
  PRICES_RATE,
  ADMIN_RATE,
  NETWORK_TIMEOUT_MS,
  MAX_REDIRECTS,
  SECURITY_HEADERS,
  LINK_CACHE_MS,
} = require('../server.js');

// Fase 4: los tests de redirección/HEAD inyectan robots permitido y throttle
// nulo; la política real se prueba en test/link-policy.test.js.
const SAFE_LINK_DEPS = { robots: { allowed: true }, throttle: { wait: async () => 0 } };

let base;

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test('GET /api/health', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, service: 'UP prototipo' });
});

test('GET /api/prices?q= devuelve el feed demo con la_query', async () => {
  const res = await fetch(`${base}/api/prices?q=leche`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.meta.mode, 'demo');
  assert.equal(json.meta.query, 'leche');
  assert.equal(json.products.length, 30);
  assert.equal(json.stores.length, 10);
  assert.equal(Object.keys(json.chains).length, 6);
});

test('GET /api/prices sin query llena meta.query con null', async () => {
  const res = await fetch(`${base}/api/prices`);
  const json = await res.json();
  assert.equal(json.meta.query, null);
});

test('allowedLink acepta solo dominios de la whitelist', () => {
  assert.equal(allowedLink('https://www.jumbo.cl/ficha'), 'https://www.jumbo.cl/ficha');
  assert.equal(allowedLink('http://lider.cl/busqueda?ft=391'), 'http://lider.cl/busqueda?ft=391');
  assert.equal(allowedLink('https://tottus.cl'), 'https://tottus.cl/');
  assert.equal(allowedLink('https://coope.cl/x'), 'https://coope.cl/x');
});

test('allowedLink rechaza SSRF: IPs, localhost, esquemas y subdominios engañosos', () => {
  const bad = [
    'file:///etc/passwd',
    'ftp://jumbo.cl/archivo',
    'http://127.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data',
    'http://localhost:3100/',
    'http://[::1]/',
    'https://192.168.1.10/',
    'https://jumbo.cl.evil.com/',
    'https://eviljumbo.cl/',
    'https://jumbo.cl@evil.com/',
    'https://notjumbo.cl/',
  ];
  bad.forEach((url) => assert.equal(allowedLink(url), null, url));
});

test('verifyLink no llama a fetch si el dominio no está permitido', async () => {
  let called = false;
  const result = await verifyLink('https://jumbo.cl.evil.com/x', {
    fetch: async () => {
      called = true;
      throw new Error('no debió llamarse');
    },
  });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Dominio no permitido');
});

test('verifyLink usa caché de 5 minutos y la respeta', async () => {
  let calls = 0;
  let now = 1000000;
  const cache = new Map();
  const fakeFetch = async () => {
    calls += 1;
    return { ok: true, status: 200, url: 'https://www.jumbo.cl/x' };
  };
  const deps = { ...SAFE_LINK_DEPS, fetch: fakeFetch, now: () => now, cache };

  const first = await verifyLink('https://www.jumbo.cl/x', deps);
  assert.equal(first.cached, undefined);
  assert.equal(calls, 1);

  const second = await verifyLink('https://www.jumbo.cl/x', deps);
  assert.equal(second.cached, true);
  assert.equal(calls, 1);

  now += LINK_CACHE_MS - 1;
  await verifyLink('https://www.jumbo.cl/x', deps);
  assert.equal(calls, 1);

  now += 2;
  const fourth = await verifyLink('https://www.jumbo.cl/x', deps);
  assert.equal(fourth.cached, undefined);
  assert.equal(calls, 2);
});

test('verifyLink reintenta HEAD → GET ante 403/405/501', async () => {
  for (const status of [403, 405, 501]) {
    const methods = [];
    const fakeFetch = async (_url, opts) => {
      methods.push(opts.method);
      return opts.method === 'HEAD'
        ? { ok: false, status, url: 'https://www.jumbo.cl/x' }
        : { ok: true, status: 200, url: 'https://www.jumbo.cl/x' };
    };
    const result = await verifyLink('https://www.jumbo.cl/x', {
      ...SAFE_LINK_DEPS,
      fetch: fakeFetch,
      cache: new Map(),
    });
    assert.deepEqual(methods, ['HEAD', 'GET']);
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
  }
});

test('verifyLink rechaza redirecciones a hosts no permitidos', async () => {
  const cache = new Map();
  const fakeFetch = async () => ({ ok: true, status: 200, url: 'https://evil.com/interior' });
  const result = await verifyLink('https://www.jumbo.cl/x', {
    ...SAFE_LINK_DEPS,
    fetch: fakeFetch,
    cache,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Redirección a host no permitido');
  assert.equal(result.paused, true);
  assert.equal(result.finalUrl, 'https://evil.com/interior');
  assert.equal(cache.size, 0);
});

test('verifyLink pausa ante una cola de espera sin contactar el destino', async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    return {
      status: 302,
      ok: false,
      headers: {
        get: (name) => (name === 'location' ? 'https://www.lider.cl/queue-it/await?id=123' : null),
      },
    };
  };
  const result = await verifyLink('https://www.lider.cl/supermercado/busqueda?ft=123', {
    ...SAFE_LINK_DEPS,
    fetch: fakeFetch,
    cache: new Map(),
  });
  assert.equal(calls, 1);
  assert.equal(result.paused, true);
  assert.match(result.error, /cola de espera|control de acceso/);
  assert.equal(result.finalUrl, 'https://www.lider.cl/queue-it/await?id=123');
});

test('verifyLink acepta redirecciones dentro de la whitelist', async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    url: 'https://www.jumbo.cl/ficha-final',
  });
  const result = await verifyLink('https://jumbo.cl/x', {
    ...SAFE_LINK_DEPS,
    fetch: fakeFetch,
    cache: new Map(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalUrl, 'https://www.jumbo.cl/ficha-final');
});

const redirectResponse = (location, url = 'https://www.jumbo.cl/inicio') => ({
  ok: false,
  status: 302,
  url,
  headers: { get: (name) => (name.toLowerCase() === 'location' ? location : null) },
});

test('verifyLink usa redirect: manual, timeout único y valida cada salto', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    if (calls.length === 1) return redirectResponse('/final', 'https://www.jumbo.cl/inicio');
    return { ok: true, status: 200, url: 'https://www.jumbo.cl/final' };
  };
  const result = await verifyLink('https://www.jumbo.cl/inicio', {
    ...SAFE_LINK_DEPS,
    fetch: fakeFetch,
    cache: new Map(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.finalUrl, 'https://www.jumbo.cl/final');
  assert.equal(result.hops, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://www.jumbo.cl/final');
  for (const call of calls) {
    assert.equal(call.opts.redirect, 'manual');
    assert.ok(call.opts.signal instanceof AbortSignal);
  }
  assert.equal(NETWORK_TIMEOUT_MS, 8000);
});

test('verifyLink rechaza un salto hostil ANTES de contactarlo', async () => {
  const contacted = [];
  const fakeFetch = async (url) => {
    contacted.push(url);
    return redirectResponse('https://evil.com/interior');
  };
  const result = await verifyLink('https://www.jumbo.cl/inicio', {
    ...SAFE_LINK_DEPS,
    fetch: fakeFetch,
    cache: new Map(),
  });
  assert.deepEqual(contacted, ['https://www.jumbo.cl/inicio']);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Redirección a host no permitido');
  assert.equal(result.paused, true);
  assert.equal(result.finalUrl, 'https://evil.com/interior');
});

test('verifyLink limita la cadena de redirecciones', async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    return redirectResponse('/loop');
  };
  const result = await verifyLink('https://www.jumbo.cl/inicio', {
    ...SAFE_LINK_DEPS,
    fetch: fakeFetch,
    cache: new Map(),
  });
  assert.equal(result.error, 'Demasiadas redirecciones');
  assert.equal(calls, MAX_REDIRECTS + 1);
});

test('verifyLink rechaza 3xx sin cabecera Location', async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 302,
    url: 'https://www.jumbo.cl/x',
    headers: { get: () => null },
  });
  const result = await verifyLink('https://www.jumbo.cl/x', {
    ...SAFE_LINK_DEPS,
    fetch: fakeFetch,
    cache: new Map(),
  });
  assert.equal(result.error, 'Redirección sin destino válido');
});

test('verifyLink pausa por robots.txt sin contactar la ficha', async () => {
  const checked = [];
  const result = await verifyLink('https://www.jumbo.cl/x', {
    robotsGuard: {
      check: async (url) => {
        checked.push(url);
        return {
          allowed: false,
          status: 200,
          error: 'robots.txt desautoriza esta ruta',
          robotsUrl: 'https://www.jumbo.cl/robots.txt',
          checkedAt: '2026-11-24T12:00:00.000Z',
        };
      },
    },
    throttle: { wait: async () => 0 },
    fetch: async () => {
      throw new Error('no debió contactar la ficha');
    },
    cache: new Map(),
  });
  assert.deepEqual(checked, ['https://www.jumbo.cl/x']);
  assert.equal(result.ok, false);
  assert.equal(result.paused, true);
  assert.equal(result.robotsPaused, true);
  assert.equal(result.robotsStatus, 'paused');
  assert.equal(result.robotsCheckedAt, '2026-11-24T12:00:00.000Z');
  assert.match(result.error, /desautoriza/);
});

test('verifyLink espacia robots.txt, reintento GET y cada salto por dominio', async () => {
  const origins = [];
  const fetched = [];
  let firstHead = true;
  const fakeFetch = async (url, options) => {
    fetched.push(`${options.method} ${url}`);
    if (url.endsWith('/robots.txt')) return { status: 200, text: async () => '' };
    if (url === 'https://www.jumbo.cl/x' && firstHead) {
      firstHead = false;
      return { status: 405, ok: false, headers: { get: () => null } };
    }
    if (url === 'https://www.jumbo.cl/x') {
      return {
        status: 302,
        ok: false,
        headers: { get: (name) => (name === 'location' ? 'https://www.jumbo.cl/y' : null) },
      };
    }
    return { status: 200, ok: true, url, headers: { get: () => null } };
  };
  const result = await verifyLink('https://www.jumbo.cl/x', {
    fetch: fakeFetch,
    cache: new Map(),
    throttle: {
      wait: async (origin) => {
        origins.push(origin);
      },
    },
    robotsGuard: {
      check: async (_url, deps) => {
        await deps.fetch('https://www.jumbo.cl/robots.txt', { method: 'GET' });
        return { allowed: true };
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalUrl, 'https://www.jumbo.cl/y');
  assert.deepEqual(origins, Array(4).fill('https://www.jumbo.cl'));
  assert.deepEqual(fetched, [
    'GET https://www.jumbo.cl/robots.txt',
    'HEAD https://www.jumbo.cl/x',
    'GET https://www.jumbo.cl/x',
    'HEAD https://www.jumbo.cl/y',
  ]);
});

test('verifyLink envía condicionales y acepta 304 como verificación válida', async () => {
  let options;
  const result = await verifyLink('https://www.jumbo.cl/x', {
    ...SAFE_LINK_DEPS,
    robots: {
      allowed: true,
      status: 200,
      robotsUrl: 'https://www.jumbo.cl/robots.txt',
      checkedAt: '2026-11-24T12:00:00.000Z',
    },
    conditional: { 'If-None-Match': '"v1"' },
    fetch: async (_url, opts) => {
      options = opts;
      return {
        status: 304,
        ok: false,
        url: 'https://www.jumbo.cl/x',
        headers: { get: (name) => (name.toLowerCase() === 'etag' ? '"v1"' : null) },
      };
    },
    cache: new Map(),
  });
  assert.equal(options.headers['If-None-Match'], '"v1"');
  assert.equal(result.ok, true);
  assert.equal(result.notModified, true);
  assert.equal(result.etag, '"v1"');
  assert.equal(result.robotsStatus, 'allowed');
  assert.equal(result.robotsUrl, 'https://www.jumbo.cl/robots.txt');
  assert.equal(result.robotsCheckedAt, '2026-11-24T12:00:00.000Z');
});

test('createRateLimiter respeta límite, ventana y Retry-After', () => {
  let t = 1000;
  const check = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });

  assert.deepEqual(check('ip-1'), { allowed: true, remaining: 1, retryAfter: 1 });
  assert.deepEqual(check('ip-1'), { allowed: true, remaining: 0, retryAfter: 1 });
  assert.deepEqual(check('ip-1'), { allowed: false, remaining: 0, retryAfter: 1 });
  // Otra IP tiene su propio contador.
  assert.deepEqual(check('ip-2'), { allowed: true, remaining: 1, retryAfter: 1 });

  t += 900;
  assert.equal(check('ip-1').allowed, false);
  t += 101;
  assert.equal(check('ip-1').allowed, true);
  check.reset();
  assert.equal(check('ip-1').allowed, true);
});

test('todas las respuestas incluyen headers de seguridad', async () => {
  for (const path of ['/api/health', '/index.html']) {
    const res = await fetch(`${base}${path}`);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      assert.equal(res.headers.get(name.toLowerCase()), value, `${path} → ${name}`);
    }
    // Ya no se permite CORS abierto: todo consumo es mismo origen.
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  }
});

test('GET /api/verify-link devuelve 429 con Retry-After al exceder el límite', async () => {
  resetRateLimits();
  try {
    const target = `${base}/api/verify-link?url=${encodeURIComponent('no-es-url')}`;
    for (let i = 0; i < VERIFY_RATE.limit; i += 1) {
      assert.equal((await fetch(target)).status, 200);
    }
    const blocked = await fetch(target);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
    assert.equal((await blocked.json()).error, 'Demasiadas solicitudes');

    // El bucket de /api/prices es independiente.
    assert.equal((await fetch(`${base}/api/prices`)).status, 200);
  } finally {
    resetRateLimits();
  }
  assert.ok(PRICES_RATE.limit >= VERIFY_RATE.limit);
});

const ADMIN_TEST_TOKEN = 'token-de-prueba-no-real';
const adminHeaders = (token) => ({ 'x-admin-token': token });

test('admin sin ADMIN_TOKEN responde 401 uniforme', async () => {
  delete process.env.ADMIN_TOKEN;
  try {
    const res = await fetch(`${base}/api/admin/status`);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { ok: false, error: 'No autorizado' });
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      assert.equal(res.headers.get(name.toLowerCase()), value, name);
    }
  } finally {
    delete process.env.ADMIN_TOKEN;
  }
});

test('admin valida la cabecera contra ADMIN_TOKEN en cada petición', async () => {
  process.env.ADMIN_TOKEN = ADMIN_TEST_TOKEN;
  resetAdminRate();
  try {
    const target = `${base}/api/admin/status`;
    const missing = await fetch(target);
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), { ok: false, error: 'No autorizado' });

    const wrong = await fetch(target, {
      headers: adminHeaders(ADMIN_TEST_TOKEN + '-malo'),
    });
    assert.equal(wrong.status, 401);
    assert.deepEqual(await wrong.json(), { ok: false, error: 'No autorizado' });

    const ok = await fetch(target, { headers: adminHeaders(ADMIN_TEST_TOKEN) });
    assert.equal(ok.status, 200);
    const body = await ok.text();
    assert.deepEqual(JSON.parse(body), {
      ok: true,
      service: 'UP admin (demo)',
      authenticated: true,
    });
    assert.equal(body.includes(ADMIN_TEST_TOKEN), false);
    for (const [name, value] of ok.headers) {
      assert.equal(value.includes(ADMIN_TEST_TOKEN), false, name);
    }
  } finally {
    resetAdminRate();
    delete process.env.ADMIN_TOKEN;
  }
});

test('admin autorizado: health responde 200 y otras rutas 404', async () => {
  process.env.ADMIN_TOKEN = ADMIN_TEST_TOKEN;
  resetAdminRate();
  try {
    const health = await fetch(`${base}/api/admin/health`, {
      headers: adminHeaders(ADMIN_TEST_TOKEN),
    });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, status: 'ok' });

    const missing = await fetch(`${base}/api/admin/no-existe`, {
      headers: adminHeaders(ADMIN_TEST_TOKEN),
    });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { ok: false, error: 'No encontrado' });
  } finally {
    resetAdminRate();
    delete process.env.ADMIN_TOKEN;
  }
});

test('admin excede el límite con 429 y Retry-After', async () => {
  process.env.ADMIN_TOKEN = ADMIN_TEST_TOKEN;
  resetAdminRate();
  try {
    const target = `${base}/api/admin/status`;
    for (let i = 0; i < ADMIN_RATE.limit; i += 1) {
      const res = await fetch(target, { headers: adminHeaders(ADMIN_TEST_TOKEN) });
      assert.equal(res.status, 200);
    }
    const blocked = await fetch(target, { headers: adminHeaders(ADMIN_TEST_TOKEN) });
    assert.equal(blocked.status, 429);
    const retryAfter = Number(blocked.headers.get('retry-after'));
    assert.ok(retryAfter >= 1);
    assert.deepEqual(await blocked.json(), {
      ok: false,
      paused: true,
      error: 'Demasiadas solicitudes',
      retryAfter,
    });
  } finally {
    resetAdminRate();
    delete process.env.ADMIN_TOKEN;
  }
});
