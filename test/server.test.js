import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { server, allowedLink, verifyLink, LINK_CACHE_MS } = require('../server.js');

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
    'https://notjumbo.cl/'
  ];
  bad.forEach((url) => assert.equal(allowedLink(url), null, url));
});

test('verifyLink no llama a fetch si el dominio no está permitido', async () => {
  let called = false;
  const result = await verifyLink('https://jumbo.cl.evil.com/x', {
    fetch: async () => { called = true; throw new Error('no debió llamarse'); }
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
  const deps = { fetch: fakeFetch, now: () => now, cache };

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
    const result = await verifyLink('https://www.jumbo.cl/x', { fetch: fakeFetch, cache: new Map() });
    assert.deepEqual(methods, ['HEAD', 'GET']);
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
  }
});

test('verifyLink rechaza redirecciones a hosts no permitidos', async () => {
  const cache = new Map();
  const fakeFetch = async () => ({ ok: true, status: 200, url: 'https://evil.com/interior' });
  const result = await verifyLink('https://www.jumbo.cl/x', { fetch: fakeFetch, cache });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Redirección a host no permitido');
  assert.equal(result.finalUrl, 'https://evil.com/interior');
  assert.equal(cache.size, 0);
});

test('verifyLink acepta redirecciones dentro de la whitelist', async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, url: 'https://www.jumbo.cl/ficha-final' });
  const result = await verifyLink('https://jumbo.cl/x', { fetch: fakeFetch, cache: new Map() });
  assert.equal(result.ok, true);
  assert.equal(result.finalUrl, 'https://www.jumbo.cl/ficha-final');
});
