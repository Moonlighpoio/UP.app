import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyMarkup, errorMarkup, loadingMarkup, skeletonCards } from '../src/states.js';

test('los skeletons son finitos, accesibles y no inventan datos', () => {
  const html = skeletonCards(99);
  assert.equal((html.match(/up-skeleton-card/g) || []).length, 12);
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /\$/);
  assert.equal(skeletonCards(0).includes('up-skeleton-card'), true);
});

test('carga, vacío y error comparten roles y mensajes accionables', () => {
  assert.match(loadingMarkup(), /role="status" aria-live="polite" aria-busy="true"/);
  assert.match(emptyMarkup({ message: 'Sin resultados' }), /role="status" aria-live="polite"/);
  assert.match(
    errorMarkup({ id: 'mi-retry' }),
    /role="alert" aria-live="assertive"[\s\S]*id="mi-retry" data-retry/
  );
  assert.match(errorMarkup(), /Reintentar/);
});

test('el HTML de estados escapa texto del catálogo', () => {
  assert.match(emptyMarkup({ title: '<script>' }), /&lt;script&gt;/);
  assert.doesNotMatch(emptyMarkup({ title: '<script>' }), /<script>/);
});
