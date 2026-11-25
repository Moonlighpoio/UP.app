import test from 'node:test';
import assert from 'node:assert/strict';
import { historyChart, historyFor } from '../src/price-history.js';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const product = { id: 'leche', prices: { lider: 1000, jumbo: 1200 } };

test('sin datos reales la serie es determinista y está etiquetada como ejemplo', () => {
  const a = historyFor(product, { days: 30, now: NOW });
  const b = historyFor(product, { days: 30, now: NOW });
  assert.equal(a.isDemo, true);
  assert.equal(a.days, 30);
  assert.equal(a.points.length, 30);
  assert.deepEqual(a.points, b.points);
  assert.ok(a.min <= a.max);
  assert.equal(a.lowestInPeriod, a.latest === a.min);
  const wide = historyFor(product, { days: 90, now: NOW });
  assert.equal(wide.points.length, 90);
  assert.equal(wide.points[0].date, new Date(NOW - 89 * DAY).toISOString().slice(0, 10));
});

test('si existe historial real se usa y no se etiqueta como ejemplo', () => {
  const withHistory = {
    ...product,
    priceHistory: [
      { at: new Date(NOW - 2 * DAY).toISOString(), price: 1100 },
      { at: new Date(NOW - DAY).toISOString(), price: 900 },
      { at: new Date(NOW).toISOString(), price: 1000 },
    ],
  };
  const history = historyFor(withHistory, { days: 30, now: NOW });
  assert.equal(history.isDemo, false);
  assert.deepEqual(
    history.points.map((p) => p.price),
    [1100, 900, 1000]
  );
  assert.equal(history.min, 900);
  assert.equal(history.max, 1100);
});

test('el gráfico produce coordenadas y marca mínimo y máximo', () => {
  const history = historyFor(product, { days: 30, now: NOW });
  const chart = historyChart(history);
  assert.equal(chart.points.length, 30);
  assert.match(chart.line, /^M/);
  assert.match(chart.area, /Z$/);
  assert.equal(chart.minPoint.price, history.min);
  assert.equal(chart.maxPoint.price, history.max);
  assert.deepEqual(historyChart({ points: [] }).points, []);
});
