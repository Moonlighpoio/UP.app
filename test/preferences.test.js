import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DELIVERY_MODES,
  normalizePreferences,
  preferenceSummary,
  shouldShowOnboarding,
  sortByPreferences,
  sortStoresByPreferences,
} from '../src/preferences.js';

test('normaliza comuna, cadenas conocidas y modo de entrega', () => {
  const clean = normalizePreferences({
    commune: 'ñuñoa',
    chains: ['lider', 'lider', 'inexistente', 'jumbo'],
    delivery: 'otro',
  });
  assert.equal(clean.commune, 'Ñuñoa');
  assert.deepEqual(clean.chains, ['lider', 'jumbo']);
  assert.equal(clean.delivery, 'despacho');
  assert.equal(clean.onboarded, false);
  assert.deepEqual(DELIVERY_MODES, ['despacho', 'retiro']);
});

test('el onboarding sólo se muestra mientras no se completó ni se omitió', () => {
  assert.equal(shouldShowOnboarding(null), true);
  assert.equal(shouldShowOnboarding({ onboarded: false }), true);
  assert.equal(shouldShowOnboarding({ onboarded: true }), false);
});

test('las cadenas preferidas son desempate, nunca cambian un orden explícito', () => {
  const products = [
    { id: 'a', prices: { jumbo: 1000 } },
    { id: 'b', prices: { lider: 2000 } },
    { id: 'c', prices: {} },
  ];
  const ordered = sortByPreferences(products, { chains: ['lider'], onboarded: true });
  assert.deepEqual(
    ordered.map((item) => item.id),
    ['b', 'a', 'c']
  );
  assert.deepEqual(
    products.map((item) => item.id),
    ['a', 'b', 'c']
  );
  assert.deepEqual(
    sortByPreferences(products, null).map((item) => item.id),
    ['a', 'b', 'c']
  );
});

test('las sucursales preferidas van primero sin alterar las distancias', () => {
  const stores = [
    { id: 'a', chain: 'jumbo', distanceKm: 1 },
    { id: 'b', chain: 'lider', distanceKm: 9 },
  ];
  const ordered = sortStoresByPreferences(stores, { chains: ['lider'] });
  assert.deepEqual(
    ordered.map((item) => item.id),
    ['b', 'a']
  );
  assert.equal(ordered[0].distanceKm, 9);
});

test('el resumen de preferencias no expone ubicación exacta', () => {
  const text = preferenceSummary({ commune: 'Providencia', chains: ['lider'], delivery: 'retiro' });
  assert.match(text, /Comuna: Providencia/);
  assert.match(text, /Cadenas: Lider/);
  assert.match(text, /Prefiere retiro/);
});
