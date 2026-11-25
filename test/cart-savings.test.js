import test from 'node:test';
import assert from 'node:assert/strict';
import { cartSavings } from '../src/cart-savings.js';

const stores = { lider: {}, jumbo: {}, tottus: {} };
const products = [
  { id: 'coca', prices: { lider: 1000, jumbo: 1200, tottus: 1500 } },
  { id: 'arroz', prices: { lider: 900, jumbo: 910, tottus: 920 } },
  { id: 'unico', prices: { lider: 500 } },
];

test('el ahorro es estimado y compara contra el precio más alto de referencia', () => {
  const result = cartSavings({
    lines: [{ productId: 'coca', storeId: 'lider', qty: 2 }],
    products,
    stores,
  });
  assert.equal(result.baseline, 3000);
  assert.equal(result.selected, 2000);
  assert.equal(result.amount, 1000);
  assert.equal(result.percent, 33);
  assert.equal(result.comparableItems, 1);
  assert.match(result.label, /Ahorras \$1\.000 estimados \(33%\)/);
  assert.doesNotMatch(result.label, /Verificado|mejor precio/i);
});

test('suma sólo líneas con al menos dos precios comparables', () => {
  const result = cartSavings({
    lines: [
      { productId: 'coca', storeId: 'lider', qty: 1 },
      { productId: 'arroz', storeId: 'jumbo', qty: 1 },
      { productId: 'unico', storeId: 'lider', qty: 1 },
      { productId: 'inexistente', storeId: 'lider', qty: 1 },
    ],
    products,
    stores,
  });
  assert.equal(result.comparableItems, 2);
  assert.equal(result.amount, 510);
  assert.ok(result.label.includes('estimados'));
});

test('sin datos suficientes no afirma un ahorro', () => {
  const result = cartSavings({ lines: [], products: [], stores });
  assert.equal(result.amount, 0);
  assert.equal(result.percent, 0);
  assert.match(result.label, /Sin precios suficientes/);
});
