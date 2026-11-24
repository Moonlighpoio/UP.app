import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { state, setCatalog, categoriesFrom } from '../src/state.js';
import {
  matchesFilters,
  sortProducts,
  priceForDisplay,
  freeShippingChainIds,
  resetAdvancedFilters,
  syncFreeShippingFilter,
} from '../src/filters.js';
import { unitInfo } from '../src/catalog.js';

const products = [
  {
    id: 'alfa',
    name: 'Alfa',
    category: 'Bebidas',
    unit: 'Botella 1 L',
    unitPricing: unitInfo('Botella 1 L'),
    description: '',
    prices: { lider: 1000, jumbo: 1200 },
  },
  {
    id: 'beta',
    name: 'Beta',
    category: 'Almacen',
    unit: 'Bolsa 500 g',
    unitPricing: unitInfo('Bolsa 500 g'),
    description: '',
    prices: { jumbo: 500 },
  },
  {
    id: 'gamma',
    name: 'Gamma',
    category: 'Bebidas',
    unit: 'Saco 1 kg',
    unitPricing: unitInfo('Saco 1 kg'),
    description: '',
    prices: { lider: 2000 },
  },
];

beforeEach(() => {
  setCatalog(products, categoriesFrom(products));
  state.selectedCategory = 'TODOS';
  state.selectedChain = 'TODOS';
  state.freeShippingOnly = false;
  state.searchQuery = '';
  state.sortBy = 'default';
  state.cart = [];
});

const ids = (list) => list.map((product) => product.id);

test('matchesFilters filtra por cadena y combina con categoría y texto', () => {
  state.selectedChain = 'lider';
  assert.deepEqual(ids(products.filter(matchesFilters)), ['alfa', 'gamma']);

  state.selectedCategory = 'Bebidas';
  state.searchQuery = 'gamma';
  assert.deepEqual(ids(products.filter(matchesFilters)), ['gamma']);
});

test('matchesFilters respeta el filtro de despacho gratis del carrito', () => {
  // 30 × $2.000 en Lider supera el umbral de $50.000.
  state.cart = [{ key: 'gamma_lider', productId: 'gamma', storeId: 'lider', qty: 30 }];
  assert.deepEqual(freeShippingChainIds(), ['lider']);

  state.freeShippingOnly = true;
  assert.deepEqual(ids(products.filter(matchesFilters)), ['alfa', 'gamma']);

  state.selectedChain = 'jumbo';
  assert.deepEqual(ids(products.filter(matchesFilters)), []);
});

test('syncFreeShippingFilter apaga el filtro cuando el carrito deja de calificar', () => {
  state.freeShippingOnly = true;
  assert.equal(syncFreeShippingFilter(), true);
  assert.equal(state.freeShippingOnly, false);

  state.freeShippingOnly = false;
  assert.equal(syncFreeShippingFilter(), false);
});

test('priceForDisplay usa la cadena elegida y cae al mejor precio', () => {
  state.selectedChain = 'lider';
  assert.deepEqual(
    { price: priceForDisplay(products[0]).price, best: priceForDisplay(products[0]).best },
    { price: 1000, best: false }
  );
  // Beta no tiene precio en Lider: se muestra su mejor precio disponible.
  assert.equal(priceForDisplay(products[1]).price, 500);
  assert.equal(priceForDisplay(products[1]).best, true);

  state.selectedChain = 'TODOS';
  assert.equal(priceForDisplay(products[0]).best, true);
});

test('sortProducts ordena por precio unitario, precio y ahorro', () => {
  state.sortBy = 'unit-asc';
  assert.deepEqual(ids(sortProducts(products)), ['beta', 'alfa', 'gamma']);

  state.sortBy = 'price-desc';
  assert.deepEqual(ids(sortProducts(products)), ['gamma', 'alfa', 'beta']);

  state.sortBy = 'savings-desc';
  assert.deepEqual(ids(sortProducts(products)), ['alfa', 'beta', 'gamma']);
});

test('sortProducts usa el precio de la cadena seleccionada', () => {
  state.selectedChain = 'jumbo';
  state.sortBy = 'price-desc';
  // En la UI esta lista ya viene filtrada: Gamma no tiene precio en Jumbo.
  assert.deepEqual(ids(sortProducts(products.filter(matchesFilters))), ['alfa', 'beta']);
});

test('resetAdvancedFilters deja cadena, despacho y orden en valores iniciales', () => {
  state.selectedChain = 'lider';
  state.freeShippingOnly = true;
  state.sortBy = 'unit-asc';
  resetAdvancedFilters();
  assert.equal(state.selectedChain, 'TODOS');
  assert.equal(state.freeShippingOnly, false);
  assert.equal(state.sortBy, 'default');
});
