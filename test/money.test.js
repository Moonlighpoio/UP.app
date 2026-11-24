import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lineTotal,
  subtotalFor,
  shippingFor,
  feeFor,
  payoutFor,
  grandTotalFor,
  calculateMoney,
  formatCLP,
} from '../src/money.js';

const STORES = {
  lider: { freeShippingThreshold: 50000, shippingCost: 3990 },
  tottus: { freeShippingThreshold: 50000, shippingCost: 3990 },
  jumbo: { freeShippingThreshold: 50000, shippingCost: 4490 },
};

test('lineTotal y subtotalFor suman precio × cantidad', () => {
  assert.equal(lineTotal(2190, 3), 6570);
  assert.equal(
    subtotalFor([
      { unitPrice: 2190, qty: 2 },
      { unitPrice: 1490, qty: 3 },
    ]),
    8850
  );
});

test('feeFor redondea el 1% por cadena, no sobre el total agregado', () => {
  assert.equal(feeFor(1250), 13); // 12,5 → 13
  assert.equal(feeFor(1499), 15); // 14,99 → 15
  assert.equal(feeFor(2090), 21); // 20,9 → 21
  assert.equal(feeFor(1), 0); // 0,01 → 0

  const result = calculateMoney({
    lines: [
      { storeId: 'lider', unitPrice: 1250, qty: 1 },
      { storeId: 'tottus', unitPrice: 1250, qty: 1 },
    ],
    stores: STORES,
  });
  assert.deepEqual(
    result.storeGroups.map((g) => g.fee),
    [13, 13]
  );
  assert.equal(result.upFee, 26);
  assert.equal(Math.round(result.productsSubtotal * 0.01), 25); // distinto a Σ round
  assert.equal(result.payoutTotal, result.productsSubtotal - 26);
});

test('carrito vacío: todo en cero y sin grupos', () => {
  const r = calculateMoney({ lines: [], stores: STORES });
  assert.deepEqual(r, {
    storeGroups: [],
    totalItems: 0,
    productsSubtotal: 0,
    totalShipping: 0,
    upFee: 0,
    payoutTotal: 0,
    grandTotal: 0,
  });
});

test('una sola cadena: despacho, fee retenido y total cobrado', () => {
  const r = calculateMoney({
    lines: [{ storeId: 'lider', unitPrice: 2190, qty: 2 }],
    stores: STORES,
  });
  assert.equal(r.totalItems, 2);
  assert.equal(r.productsSubtotal, 4380);
  assert.equal(r.storeGroups[0].missingForFree, 45620);
  assert.equal(r.storeGroups[0].shipping, 3990);
  assert.equal(r.storeGroups[0].progressPct, 9);
  assert.equal(r.upFee, 44);
  assert.equal(r.storeGroups[0].payout, 4336);
  assert.equal(r.totalShipping, 3990);
  assert.equal(r.grandTotal, 8370); // 4380 + 3990, sin sumar el fee
  assert.equal(r.grandTotal, grandTotalFor(r.productsSubtotal, r.totalShipping));
});

test('varias cadenas: agrupa y suma despachos y fees por separado', () => {
  const r = calculateMoney({
    lines: [
      { storeId: 'lider', unitPrice: 2190, qty: 2 },
      { storeId: 'tottus', unitPrice: 1490, qty: 3 },
    ],
    stores: STORES,
  });
  assert.equal(r.storeGroups.length, 2);
  assert.equal(r.productsSubtotal, 8850);
  assert.deepEqual(
    r.storeGroups.map((g) => g.fee),
    [44, 45]
  );
  assert.equal(r.upFee, 89);
  assert.equal(r.totalShipping, 7980);
  assert.equal(r.grandTotal, 16830);
  assert.equal(r.payoutTotal, 8761);
});

test('justo en el umbral de envío gratis', () => {
  const info = shippingFor(STORES.lider, 50000);
  assert.equal(info.missingForFree, 0);
  assert.equal(info.isFreeShipping, true);
  assert.equal(info.shipping, 0);
  assert.equal(info.progressPct, 100);

  const r = calculateMoney({
    lines: [{ storeId: 'lider', unitPrice: 50000, qty: 1 }],
    stores: STORES,
  });
  assert.equal(r.totalShipping, 0);
  assert.equal(r.grandTotal, 50000);
  assert.equal(r.upFee, 500);
  assert.equal(payoutFor(50000), 49500);
});

test('un peso por debajo del umbral sigue pagando despacho', () => {
  const info = shippingFor(STORES.lider, 49999);
  assert.equal(info.missingForFree, 1);
  assert.equal(info.isFreeShipping, false);
  assert.equal(info.shipping, 3990);
  assert.equal(info.progressPct, 100);
});

test('cantidades grandes mantienen precisión entera', () => {
  const mega = { freeShippingThreshold: 200000000, shippingCost: 9990 };
  const r = calculateMoney({
    lines: [{ storeId: 'mega', unitPrice: 99990, qty: 1000 }],
    stores: { mega },
  });
  assert.equal(r.productsSubtotal, 99990000);
  assert.equal(r.upFee, 999900);
  assert.equal(r.payoutTotal, 98990100);
  assert.equal(r.totalShipping, 9990);
  assert.equal(r.grandTotal, 99999990);
  assert.equal(Number.isSafeInteger(r.grandTotal), true);
});

test('formatCLP usa separadores es-CL', () => {
  assert.equal(formatCLP(0), '$0');
  assert.equal(formatCLP(2090), '$2.090');
  assert.equal(formatCLP(999990), '$999.990');
  assert.equal(formatCLP(1234567.6), '$1.234.568');
});
