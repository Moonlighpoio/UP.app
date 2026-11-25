import test from 'node:test';
import assert from 'node:assert/strict';
import { STALE_DAYS, STALE_MS } from '../src/config.js';
import {
  capturedAtOf,
  freshnessFor,
  humanAge,
  isVerifiedFresh,
  verifiedPriceLabel,
} from '../src/freshness.js';
import { getConfirmedProductStats, hasVerifiedFreshPrice } from '../src/catalog.js';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const fresh = { status: 'verified', priceCapturedAt: '2026-11-24T09:00:00Z' };
const old = { status: 'verified', verifiedAt: '2026-11-01T09:00:00Z' };
const pending = { status: 'pending', priceCapturedAt: '2026-11-24T09:00:00Z' };

test('capturedAtOf prefiere la fecha del precio y nunca inventa una', () => {
  assert.equal(capturedAtOf(fresh), '2026-11-24T09:00:00.000Z');
  assert.equal(capturedAtOf({ verifiedAt: '2026-11-23' }), '2026-11-23T00:00:00.000Z');
  assert.equal(capturedAtOf({}), null);
  assert.equal(capturedAtOf({ priceCapturedAt: 'no-fecha' }), null);
});

test('freshnessFor calcula antigüedad y marca stale según el umbral', () => {
  const options = { now: NOW };
  assert.equal(freshnessFor(fresh, options).label, 'Actualizado hace 3 h');
  assert.equal(freshnessFor(fresh, options).stale, false);
  assert.equal(freshnessFor(old, options).tone, 'warning');
  assert.equal(freshnessFor(old, options).label, 'Precio desactualizado');
  assert.equal(freshnessFor({}, options).stale, true);
  assert.equal(STALE_DAYS, 7);
  assert.equal(STALE_MS, 7 * 24 * 60 * 60 * 1000);
});

test('humanAge usa unidades legibles en español', () => {
  assert.equal(humanAge(30 * 60000), 'hace 30 min');
  assert.equal(humanAge(26 * 60 * 60000), 'hace 1 d');
  assert.equal(humanAge(45 * 24 * 60 * 60000), 'hace 1 mes');
  assert.equal(humanAge(-1), 'sin fecha');
});

test('sólo verificadas y frescas entran en mejor precio', () => {
  const options = { now: NOW };
  assert.equal(isVerifiedFresh(fresh, options), true);
  assert.equal(isVerifiedFresh(old, options), false);
  assert.equal(isVerifiedFresh(pending, options), false);
  assert.equal(verifiedPriceLabel(fresh, options), 'Precio verificado el 24/11');
  assert.equal(verifiedPriceLabel(pending, options), '');
});

test('getConfirmedProductStats excluye pendientes, stale y overrides locales', () => {
  const product = {
    id: 'p1',
    prices: { lider: 1000, jumbo: 900, tottus: 800 },
    skus: {
      lider: fresh,
      jumbo: { ...fresh, priceCapturedAt: '2026-10-01T09:00:00Z' },
      tottus: pending,
    },
  };
  const stats = getConfirmedProductStats(product, { now: NOW });
  assert.equal(stats.minPrice, 1000);
  assert.equal(stats.bestStore.id, 'lider');
  assert.equal(hasVerifiedFreshPrice(product, { now: NOW }), true);

  const overridden = getConfirmedProductStats(product, {
    now: NOW,
    overrides: { p1_lider: { status: 'pending' } },
  });
  assert.equal(overridden.minPrice, null);
  assert.equal(
    hasVerifiedFreshPrice(product, { now: NOW, overrides: { p1_lider: { status: 'pending' } } }),
    false
  );
});
