import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addRecentSearch,
  clearRecentSearches,
  popularSearches,
  recentSearches,
  recordSearch,
} from '../src/search.js';
import { MAX_RECENT_SEARCHES } from '../src/suggest.js';

test('recientes conservan el orden, deduplican y respetan el límite', () => {
  const state = {};
  for (let i = 0; i < 12; i += 1) addRecentSearch(state, `termino-${i}`);
  assert.equal(recentSearches(state).length, MAX_RECENT_SEARCHES);
  assert.equal(recentSearches(state)[0], 'termino-11');
  assert.equal(recentSearches(state).at(-1), 'termino-4');
  addRecentSearch(state, '  TERMINO-11  ');
  assert.equal(recentSearches(state).length, MAX_RECENT_SEARCHES);
  assert.equal(recentSearches(state)[0], 'TERMINO-11');
  assert.equal(recentSearches(state).filter((item) => /^termino-11$/i.test(item)).length, 1);
  addRecentSearch(state, 'a');
  assert.equal(recentSearches(state).length, MAX_RECENT_SEARCHES);
});

test('populares se derivan de eventos search sin exponer datos personales', () => {
  const state = {
    analytics: [
      { event: 'search', props: { query: 'leche', results: 4 } },
      { event: 'search', props: { query: 'coca', results: 2 } },
      { event: 'search', props: { query: 'leche', results: 4, email: 'x@ejemplo.cl' } },
      { event: 'view_product', props: { query: 'arroz' } },
    ],
  };
  assert.deepEqual(popularSearches(state), ['leche', 'coca']);
  assert.deepEqual(popularSearches(state, 1), ['leche']);
});

test('recordSearch escribe búsqueda, resultado y evento de sin resultados', () => {
  const state = {};
  const now = Date.parse('2026-11-25T03:00:00Z');
  assert.equal(recordSearch(state, '  leche-u2  ', 0, { now }), 'leche-u2');
  assert.deepEqual(state.recentSearches, ['leche-u2']);
  assert.deepEqual(
    state.analytics.map((event) => event.event),
    ['search', 'search_no_results']
  );
  assert.deepEqual(state.analytics[0].props, { query: 'leche-u2', results: 0 });
  assert.deepEqual(state.analytics[1].props, { query: 'leche-u2' });

  assert.equal(recordSearch(state, 'leche-u2', 0, { now: now + 100 }), null);
  assert.equal(recordSearch(state, 'leche-u2', 0, { now: now + 2000 }), 'leche-u2');
  assert.equal(state.analytics.filter((event) => event.event === 'search_no_results').length, 2);
  assert.equal(recordSearch(state, 'arroz-u2', 3, { now: now + 3000 }), 'arroz-u2');
  assert.equal(
    state.analytics.some(
      (event) => event.event === 'search_no_results' && event.props.query === 'arroz-u2'
    ),
    false
  );
  assert.equal(recordSearch(state, 'a', 0, { now: now + 4000 }), null);
});

test('clearRecentSearches elimina sólo el historial local', () => {
  const state = { recentSearches: ['leche', 'coca'], analytics: [{ event: 'search' }] };
  clearRecentSearches(state);
  assert.deepEqual(state.recentSearches, []);
  assert.equal(state.analytics.length, 1);
});
