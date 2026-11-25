import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addToComparison,
  comparisonMatrix,
  MAX_COMPARE_PRODUCTS,
  removeFromComparison,
  toggleComparison,
} from '../src/compare-products.js';
import { overrideKey } from '../src/reports.js';

test('la comparación acepta hasta tres productos sin duplicados', () => {
  const first = addToComparison([], 'leche');
  assert.deepEqual(first.ids, ['leche']);
  assert.deepEqual(addToComparison(first.ids, 'leche'), {
    ids: ['leche'],
    added: false,
    reason: 'ya',
  });
  const full = addToComparison(addToComparison(first.ids, 'arroz').ids, 'cafe');
  assert.equal(full.ids.length, MAX_COMPARE_PRODUCTS);
  assert.deepEqual(addToComparison(full.ids, 'azucar'), {
    ids: full.ids,
    added: false,
    reason: 'limite',
  });
  assert.deepEqual(removeFromComparison(full.ids, 'arroz'), ['leche', 'cafe']);
  assert.deepEqual(toggleComparison(['leche'], 'leche').ids, []);
});

test('la matriz incluye precio por cadena, $/unidad, formato y procedencia', () => {
  const products = [
    {
      id: 'leche',
      name: 'Leche',
      category: 'Lácteos',
      unit: 'Botella 1 L',
      unitPricing: { quantity: 1, divisor: 1, label: '/L', unit: 'L' },
      prices: { lider: 1000, jumbo: 1200 },
      skus: { lider: { status: 'verified' }, jumbo: { status: 'pending' } },
    },
  ];
  const rows = comparisonMatrix(products, { overrides: {} });
  assert.equal(rows[0].format, 'Botella 1 L');
  assert.equal(rows[0].minPrice, 1000);
  assert.equal(rows[0].chains.find((c) => c.chainId === 'lider').confirmed, true);
  assert.equal(rows[0].chains.find((c) => c.chainId === 'lider').unitPrice, 1000);
  assert.equal(rows[0].chains.find((c) => c.chainId === 'jumbo').confirmed, false);

  const overridden = comparisonMatrix(products, {
    overrides: { [overrideKey('leche', 'lider')]: { status: 'pending' } },
  });
  assert.equal(overridden[0].chains.find((c) => c.chainId === 'lider').confirmed, false);
});
