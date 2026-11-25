import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approximateMatch,
  didYouMean,
  editDistance,
  highlightMatch,
  isGtin13,
  MAX_RECENT_SEARCHES,
  productForGtin,
  suggestionsFor,
} from '../src/suggest.js';

const products = [
  {
    id: 'leche-1',
    name: 'Leche entera 1 L',
    category: 'Lácteos',
    skus: { lider: { gtin: '7801610001622' } },
  },
  {
    id: 'coca-1',
    name: 'Coca-Cola Original 1.5 L',
    category: 'Bebidas',
    skus: { jumbo: { gtin: '5901234123457' } },
  },
];

test('editDistance acota el costo y tolera una inserción', () => {
  assert.equal(editDistance('leche', 'lechee'), 1);
  assert.equal(editDistance('coca', 'cola', 1), 1);
  assert.equal(editDistance('abc', 'xyz', 1), 2);
  assert.equal(editDistance('', ''), 0);
});

test('approximateMatch tolera errores por token sin inventar coincidencias', () => {
  assert.equal(approximateMatch('lech', 'Leche entera 1 L'), true);
  assert.equal(approximateMatch('coca cola', 'Coca-Cola Original 1.5 L'), true);
  assert.equal(approximateMatch('xyzq', 'Leche entera 1 L'), false);
  assert.equal(approximateMatch('leche', 'Lácteos'), false);
});

test('suggestionsFor mezcla recientes, populares y datos del catálogo sin duplicados', () => {
  assert.equal(MAX_RECENT_SEARCHES, 8);
  const empty = suggestionsFor('', products, {
    recent: ['leche', 'arroz'],
    popular: ['coca', 'leche', 'detergente'],
  });
  assert.deepEqual(
    empty.map((item) => `${item.type}:${item.value}`),
    ['reciente:leche', 'reciente:arroz', 'popular:coca', 'popular:detergente']
  );

  const typed = suggestionsFor('lech', products);
  assert.ok(typed.some((item) => item.type === 'producto' && item.value === 'Leche entera 1 L'));
  assert.equal(new Set(typed.map((item) => `${item.type}:${item.value}`)).size, typed.length);
});

test('didYouMean corrige tokens y no propone una palabra ya escrita', () => {
  assert.equal(didYouMean('lechee', products), 'Leche entera 1 L');
  assert.equal(didYouMean('coka-cola', products), 'Coca-Cola Original 1.5 L');
  assert.equal(didYouMean('leche', products), null);
  assert.equal(didYouMean('le', products), null);
});

test('highlightMatch resalta sin inyectar HTML', () => {
  assert.equal(highlightMatch('Leche entera', 'leche'), '<mark>Leche</mark> entera');
  const unsafe = highlightMatch('<script>alert(1)</script>', '<script>');
  assert.ok(!unsafe.includes('<script>'));
  assert.ok(unsafe.includes('&lt;mark&gt;') === false);
  assert.ok(unsafe.includes('<mark>&lt;script&gt;</mark>'));
});

test('GTIN EAN-13 valida dígito verificador y mapea al producto correcto', () => {
  assert.equal(isGtin13('7801610001622'), true);
  assert.equal(isGtin13('5901234123457'), true);
  assert.equal(isGtin13('7801610001623'), false);
  assert.equal(isGtin13('12345678'), false);
  assert.equal(productForGtin(products, '780 1610001622')?.id, 'leche-1');
  assert.equal(productForGtin(products, '7801610001623'), null);
});
