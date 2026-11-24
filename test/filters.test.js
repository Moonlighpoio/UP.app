import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { state, setCatalog, categoriesFrom } from '../src/state.js';
import {
  activeFilterChips,
  facetCounts,
  matchesFilters,
  sortProducts,
  priceForDisplay,
  freeShippingChainIds,
  readUrlFilters,
  resetAdvancedFilters,
  resetAllFilters,
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
    promos: {},
    skus: { lider: { sku: 'A1', url: 'https://www.lider.cl/ficha-a1' } },
  },
  {
    id: 'beta',
    name: 'Beta',
    category: 'Almacen',
    unit: 'Bolsa 500 g',
    unitPricing: unitInfo('Bolsa 500 g'),
    description: '',
    prices: { jumbo: 500 },
    promos: {},
    skus: {},
  },
  {
    id: 'gamma',
    name: 'Gamma',
    category: 'Bebidas',
    unit: 'Saco 1 kg',
    unitPricing: unitInfo('Saco 1 kg'),
    description: '',
    prices: { lider: 2000 },
    promos: {},
    skus: {},
  },
];

beforeEach(() => {
  setCatalog(products, categoriesFrom(products));
  state.selectedCategory = 'TODOS';
  state.selectedChain = 'TODOS';
  state.freeShippingOnly = false;
  state.searchQuery = '';
  state.sortBy = 'default';
  state.minPrice = 0;
  state.maxPrice = Infinity;
  state.offersOnly = false;
  state.maxDelivery = 0;
  state.availability = 'TODOS';
  state.cart = [];
  products.forEach((product) => {
    product.promos = {};
  });
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

test('el rango de precio usa el precio mostrado y respeta la cadena elegida', () => {
  state.minPrice = 900;
  state.maxPrice = 1500;
  assert.deepEqual(ids(products.filter(matchesFilters)), ['alfa']);

  state.selectedChain = 'lider';
  state.maxPrice = 1100;
  assert.deepEqual(ids(products.filter(matchesFilters)), ['alfa']);
});

test('solo ofertas filtra por promoción de la cadena visible', () => {
  products[0].promos = { lider: '2x1' };
  state.offersOnly = true;
  assert.deepEqual(ids(products.filter(matchesFilters)), ['alfa']);

  state.selectedChain = 'jumbo';
  assert.deepEqual(ids(products.filter(matchesFilters)), []);
});

test('el plazo de despacho usa la estimación de la cadena con precio', () => {
  const slow = {
    ...products[0],
    id: 'delta',
    prices: { santaisabel: 3000 },
    skus: {},
    promos: {},
  };
  state.maxDelivery = 24;
  assert.equal(matchesFilters(slow), false);
  state.maxDelivery = 48;
  assert.equal(matchesFilters(slow), true);
});

test('disponibilidad distingue precio confirmado de precio referencial', () => {
  state.availability = 'CONFIRMADO';
  assert.deepEqual(ids(products.filter(matchesFilters)), ['alfa']);

  state.availability = 'REFERENCIAL';
  assert.deepEqual(ids(products.filter(matchesFilters)), ['beta', 'gamma']);
});

test('readUrlFilters interpreta los parametros del rediseño', () => {
  const values = readUrlFilters(
    '?cat=Bebidas&chain=jumbo&sort=price-asc&min=1000&max=1800&offers=1&delivery=24&availability=CONFIRMADO'
  );
  assert.equal(values.selectedCategory, 'Bebidas');
  assert.equal(values.selectedChain, 'jumbo');
  assert.equal(values.sortBy, 'price-asc');
  assert.equal(values.minPrice, 1000);
  assert.equal(values.maxPrice, 1800);
  assert.equal(values.offersOnly, true);
  assert.equal(values.maxDelivery, 24);
  assert.equal(values.availability, 'CONFIRMADO');
  assert.equal(
    readUrlFilters('/UP.app/?cat=Bebidas&offers=1#catalogo').selectedCategory,
    'Bebidas'
  );
});

test('los contadores y chips reflejan el estado activo', () => {
  assert.equal(facetCounts().all, 3);
  state.selectedChain = 'lider';
  state.offersOnly = true;
  assert.equal(facetCounts().offers, 0);
  assert.ok(activeFilterChips().some((chip) => chip.key === 'chain'));

  resetAllFilters();
  assert.equal(state.selectedCategory, 'TODOS');
  assert.equal(state.selectedChain, 'TODOS');
  assert.equal(state.offersOnly, false);
  assert.equal(state.availability, 'TODOS');
});
