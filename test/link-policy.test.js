import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseRobots,
  robotsAllows,
  groupFor,
  createRobotsGuard,
  createDomainThrottle,
  backoffWithJitter,
  conditionalHeaders,
  urlQueueStatus,
  MIN_REQUEST_INTERVAL_MS,
} = require('../lib/link-policy.js');

test('parseRobots respeta grupos, wildcard, regla más específica y Crawl-delay', () => {
  const robots = parseRobots(`
    # comentario
    User-agent: *
    Disallow: *?map=
    Allow: /producto/p
    Crawl-delay: 2

    User-agent: UP-Prototype
    Disallow: /privado/
  `);
  assert.equal(groupFor(robots, 'Other/1.0').crawlDelayMs, 2000);
  assert.equal(groupFor(robots, 'UP-Prototype/1.0').agents[0], 'up-prototype');
  assert.equal(
    robotsAllows(robots, 'https://www.jumbo.cl/producto/p', {
      userAgent: 'UP-Prototype/1.0',
    }),
    true
  );
  assert.equal(
    robotsAllows(robots, 'https://www.jumbo.cl/privado/x', {
      userAgent: 'UP-Prototype/1.0',
    }),
    false
  );
  assert.equal(
    robotsAllows(robots, 'https://www.jumbo.cl/x?map=1', {
      userAgent: 'Other/1.0',
    }),
    false
  );
  assert.equal(
    robotsAllows(parseRobots('User-agent: *\nDisallow: *.pdf'), 'https://www.jumbo.cl/a/b.pdf'),
    false
  );
  // Regla real de Jumbo: `?` es literal, no un cuantificador de regex.
  const jumboLike = parseRobots('User-agent: *\nDisallow: *?map=\nDisallow: *?*?');
  assert.equal(robotsAllows(jumboLike, 'https://www.jumbo.cl/aceite-1l/p'), true);
  assert.equal(robotsAllows(jumboLike, 'https://www.jumbo.cl/busca?ft=aceite'), true);
  assert.equal(robotsAllows(jumboLike, 'https://www.jumbo.cl/x?ft=a?map=b'), false);
  assert.equal(robotsAllows(parseRobots(''), 'https://www.jumbo.cl/x'), true);
});

test('createRobotsGuard lee robots.txt una vez por origen y aplica reglas por ruta', async () => {
  const guard = createRobotsGuard({ cache: new Map() });
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    return {
      status: 200,
      text: async () => 'User-agent: *\nDisallow: /no/\nCrawl-delay: 1',
    };
  };
  const ok = await guard.check('https://www.jumbo.cl/si', { fetch: fakeFetch, now: () => 1000 });
  const blocked = await guard.check('https://www.jumbo.cl/no/x', {
    fetch: fakeFetch,
    now: () => 2000,
  });
  assert.deepEqual(calls, ['https://www.jumbo.cl/robots.txt']);
  assert.equal(ok.allowed, true);
  assert.equal(ok.crawlDelayMs, 1000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.cached, true);
});

test('createRobotsGuard pausa ante 403/429 y permite cuando robots.txt no existe', async () => {
  const paused = await createRobotsGuard().check('https://www.jumbo.cl/x', {
    now: () => 1000,
    fetch: async () => ({
      status: 429,
      headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? '2' : null) },
    }),
  });
  assert.equal(paused.allowed, false);
  assert.equal(paused.paused, true);
  assert.equal(paused.retryAfterMs, 2000);
  assert.match(paused.error, /no se marca enlace roto/);

  const missing = await createRobotsGuard().check('https://www.jumbo.cl/x', {
    now: () => 1000,
    fetch: async () => ({ status: 404 }),
  });
  assert.equal(missing.allowed, true);
  assert.equal(missing.status, 404);
});

test('createDomainThrottle espacia por dominio y respeta Crawl-delay mayor', async () => {
  let time = 0;
  const waits = [];
  const sleep = async (ms) => {
    waits.push(ms);
    time += ms;
  };
  const throttle = createDomainThrottle({ now: () => time, sleep, random: () => 0 });
  assert.equal(await throttle.wait('https://www.jumbo.cl'), 0);
  assert.equal(await throttle.wait('https://www.jumbo.cl'), MIN_REQUEST_INTERVAL_MS);
  assert.equal(await throttle.wait('https://www.lider.cl'), 0);
  assert.equal(await throttle.wait('https://www.jumbo.cl', 3000), 3000);
  assert.deepEqual(waits, [1500, 3000]);

  let upperTime = 0;
  const upperWaits = [];
  const upper = createDomainThrottle({
    now: () => upperTime,
    sleep: async (ms) => {
      upperWaits.push(ms);
      upperTime += ms;
    },
    random: () => 1,
  });
  assert.equal(await upper.wait('https://www.jumbo.cl'), 0);
  assert.equal(await upper.wait('https://www.jumbo.cl'), 2000);
  assert.deepEqual(upperWaits, [2000]);
});

test('backoff con jitter, cabeceras condicionales y estados de url_queue', () => {
  assert.equal(backoffWithJitter(0, { baseMs: 1000, random: () => 0 }), 1000);
  assert.equal(backoffWithJitter(1, { baseMs: 1000, random: () => 0.5 }), 2300);
  assert.deepEqual(conditionalHeaders('"abc"', 'Mon, 24 Nov 2026 00:00:00 GMT'), {
    'If-None-Match': '"abc"',
    'If-Modified-Since': 'Mon, 24 Nov 2026 00:00:00 GMT',
  });
  assert.deepEqual(conditionalHeaders(null, null), {});
  assert.equal(urlQueueStatus({ ok: true }), 'verified');
  assert.equal(urlQueueStatus({ paused: true }), 'paused');
  assert.equal(urlQueueStatus({ ok: false, status: 404 }), 'broken');
  assert.equal(urlQueueStatus({ ok: false, status: 500 }), 'unavailable');
});
