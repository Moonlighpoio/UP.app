import test from 'node:test';
import assert from 'node:assert/strict';
import { favoriteProducts, isFavorite, toggleFavorite } from '../src/favorites.js';

const products = [
  { id: 'leche', name: 'Leche' },
  { id: 'arroz', name: 'Arroz' },
];

test('favoritos sólo aceptan productos del catálogo cargado', () => {
  const state = { favorites: [] };
  assert.equal(toggleFavorite(state, 'leche', products), true);
  assert.equal(isFavorite(state, 'leche'), true);
  assert.equal(toggleFavorite(state, 'inexistente', products), null);
  assert.deepEqual(state.favorites, ['leche']);
  assert.deepEqual(favoriteProducts(state, products), [products[0]]);
});

test('favoritos se alternan y se limitan sin duplicados', () => {
  const state = { favorites: [] };
  toggleFavorite(state, 'leche', products);
  toggleFavorite(state, 'arroz', products);
  toggleFavorite(state, 'leche', products);
  assert.deepEqual(state.favorites, ['arroz']);
  assert.equal(toggleFavorite(state, 'leche', products), true);
  assert.equal(state.favorites.length, 2);
  toggleFavorite(state, 'leche', products);
  toggleFavorite(state, 'leche', products);
  assert.deepEqual(state.favorites, ['arroz', 'leche']);
});
