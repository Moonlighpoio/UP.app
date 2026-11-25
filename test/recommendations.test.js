import test from 'node:test';
import assert from 'node:assert/strict';
import { addBuyAgainToCart, buyAgainProducts } from '../src/recommendations.js';

const products = [
  { id: 'leche', name: 'Leche' },
  { id: 'arroz', name: 'Arroz' },
  { id: 'cafe', name: 'Café' },
];
const item = (productId, qty) => ({ productId, qty, unitPrice: 1000 });
const group = (storeId, items) => ({ storeId, items });
const orders = [
  {
    status: 'entregado',
    createdAt: '2026-11-20T10:00:00Z',
    storeGroups: [group('lider', [item('leche', 2), item('arroz', 1)])],
  },
  {
    status: 'entregado',
    createdAt: '2026-11-22T10:00:00Z',
    storeGroups: [group('jumbo', [item('leche', 3)])],
  },
  {
    status: 'preparando',
    createdAt: '2026-11-24T10:00:00Z',
    storeGroups: [group('tottus', [item('cafe', 1)])],
  },
];

test('comprar de nuevo usa pedidos entregados y ordena por frecuencia', () => {
  const result = buyAgainProducts(orders, products);
  assert.deepEqual(
    result.map((entry) => entry.productId),
    ['leche', 'arroz']
  );
  assert.equal(result[0].times, 2);
  assert.equal(result[0].units, 5);
  assert.equal(result[0].storeId, 'jumbo');
  assert.equal(buyAgainProducts(orders, products, 1).length, 1);
});

test('agregar todo delega en addToCart y respeta la cadena de la última compra', () => {
  const calls = [];
  const items = buyAgainProducts(orders, products);
  assert.equal(
    addBuyAgainToCart(items, (...args) => calls.push(args)),
    2
  );
  assert.deepEqual(calls, [
    ['leche', 'jumbo', 3],
    ['arroz', 'lider', 1],
  ]);
  assert.equal(
    addBuyAgainToCart([{ productId: 'x', storeId: '' }], () => calls.push('x')),
    0
  );
});
