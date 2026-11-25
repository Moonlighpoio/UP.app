import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedOffersFor, optimizeList } from '../src/optimizer.js';
import { overrideKey } from '../src/reports.js';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const fresh = { status: 'verified', verifiedAt: new Date(NOW - 3 * 3600 * 1000).toISOString() };
const stale = { status: 'verified', verifiedAt: new Date(NOW - 10 * DAY).toISOString() };
const pending = { status: 'pending', verifiedAt: new Date(NOW - 3600 * 1000).toISOString() };

const products = [
  {
    id: 'leche',
    name: 'Leche entera',
    prices: { lider: 10000, jumbo: 30000, santaisabel: 9000 },
    skus: { lider: fresh, jumbo: fresh, santaisabel: stale },
  },
  {
    id: 'arroz',
    name: 'Arroz',
    prices: { lider: 50000, jumbo: 20000, santaisabel: 10000 },
    skus: { lider: fresh, jumbo: fresh, santaisabel: pending },
  },
  {
    id: 'sin-precio',
    name: 'Producto sin precio confirmado',
    prices: { lider: 7000 },
    skus: { lider: pending },
  },
];

const items = products.map((product) => ({ productId: product.id, qty: 1 }));
const base = { products, items, now: NOW };

test('sólo ofertas verificadas y frescas entran al optimizador', () => {
  const offers = confirmedOffersFor(products[0], base);
  assert.deepEqual(
    offers.map((offer) => offer.chainId),
    ['lider', 'jumbo']
  );
  const overridden = confirmedOffersFor(products[0], {
    ...base,
    overrides: { [overrideKey('leche', 'lider')]: { status: 'pending' } },
  });
  assert.deepEqual(
    overridden.map((offer) => offer.chainId),
    ['jumbo']
  );
  assert.deepEqual(confirmedOffersFor(products[2], base), []);
});

test('optimizador calcula single, reparto óptimo y cercanía con despacho real', () => {
  const result = optimizeList({
    ...base,
    commune: 'Providencia',
    storesData: [
      {
        id: 'lid-prov',
        chain: 'lider',
        name: 'Lider Providencia',
        comuna: 'Providencia',
        distanceKm: 1.2,
      },
      {
        id: 'jum-sal',
        chain: 'jumbo',
        name: 'Jumbo Salesiano',
        comuna: 'Ñuñoa',
        distanceKm: 2.1,
      },
    ],
  });

  assert.equal(result.scenarios.length, 3);
  const [single, split, nearest] = result.scenarios;
  assert.equal(single.id, 'single-jumbo');
  assert.equal(single.total, 50000); // 30.000 + 20.000 con envío gratis
  assert.equal(single.shipping, 0);
  assert.equal(single.covered, 2);
  assert.equal(single.missing[0].productId, 'sin-precio');

  assert.equal(split.id, 'split-lider-jumbo');
  assert.equal(split.total, 38480); // Lider 10.000 + 3.990; Jumbo 20.000 + 4.490
  assert.ok(split.savings > single.savings);
  assert.equal(split.missing.length, 1);
  assert.equal(split.assignments.arroz.chainId, 'jumbo');

  assert.equal(nearest.id, 'nearest');
  assert.equal(nearest.available, true);
  assert.equal(nearest.chainIds[0], 'lider');
  assert.equal(nearest.storeHint.name, 'Lider Providencia');
  assert.equal(nearest.storeHint.isDemo, true);
  assert.equal(nearest.total, 60000); // envío gratis al superar 50.000
  assert.equal(nearest.shipping, 0);
  assert.equal(nearest.missing.length, 1);
});

test('sin comuna el tercer escenario queda explícitamente sin datos', () => {
  const result = optimizeList(base);
  assert.equal(result.scenarios[2].id, 'nearest');
  assert.equal(result.scenarios[2].available, false);
  assert.equal(result.scenarios[2].total, null);
});

test('sin ofertas confirmadas no propone escenarios ni totales inventados', () => {
  const result = optimizeList({
    ...base,
    items: [{ productId: 'sin-precio', qty: 2 }],
  });
  assert.deepEqual(result.scenarios, []);
  assert.match(result.message, /verificadas/);
});
