import test from 'node:test';
import assert from 'node:assert/strict';
import { unitInfo, unitPriceFor } from '../src/catalog.js';

test('unitInfo interpreta litros, metros y kilos', () => {
  assert.deepEqual(unitInfo('Botella desechable 1,5 L'), {
    quantity: 1.5,
    unit: 'L',
    divisor: 1,
    label: '/L',
  });
  assert.deepEqual(unitInfo('Saco 1 kg'), {
    quantity: 1,
    unit: 'kg',
    divisor: 1,
    label: '/kg',
  });
  assert.deepEqual(unitInfo('18 rollos · 50 m c/u'), {
    quantity: 50,
    unit: 'm',
    divisor: 1,
    label: '/m',
  });
});

test('unitInfo normaliza gramos y mililitros a cada 100', () => {
  assert.deepEqual(unitInfo('Bolsa 500 g'), {
    quantity: 500,
    unit: 'g',
    divisor: 0.01,
    label: '/100 g',
  });
  assert.deepEqual(unitInfo('Caja 1 L · sin lactosa'), {
    quantity: 1,
    unit: 'L',
    divisor: 1,
    label: '/L',
  });
});

test('unitInfo elige la unidad con mayor prioridad y tolera texto ruidoso', () => {
  assert.equal(unitInfo('Importada · 2 a 3 un. aprox.').unit, 'un');
  assert.equal(unitInfo('Importada · 2 a 3 un. aprox.').quantity, 3);
  assert.equal(unitInfo('70 x 90 cm · 10 un.').unit, 'un');
  assert.equal(unitInfo('Doble hoja · 26 m · 2 un.').unit, 'm');
  assert.equal(unitInfo('Sin medida'), null);
  assert.equal(unitInfo(''), null);
});

test('unitPriceFor calcula precio por unidad y respeta cacheo del producto', () => {
  const product = { unit: 'Bolsa 500 g', unitPricing: unitInfo('Bolsa 500 g') };
  assert.deepEqual(unitPriceFor(product, 1000), {
    value: 200,
    label: '/100 g',
    quantity: 500,
    unit: 'g',
  });

  const withoutCache = { unit: 'Botella 1 L' };
  assert.equal(unitPriceFor(withoutCache, 1500).value, 1500);
  assert.equal(unitPriceFor(withoutCache, 1500).label, '/L');
});

test('unitPriceFor devuelve null sin precio válido o sin unidad', () => {
  assert.equal(unitPriceFor({ unit: 'Bolsa 500 g' }, 0), null);
  assert.equal(unitPriceFor({ unit: 'Bolsa 500 g' }, null), null);
  assert.equal(unitPriceFor({ unit: 'Granel' }, 1000), null);
});
