import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { visibleFocusables, openDialog, closeDialog, trapDialogTab } from '../src/a11y.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

test('hay enlace para saltar al catálogo y se revela al enfocarlo', () => {
  assert.match(html, /<a href="#catalogo" class="skip-link">Saltar al catálogo<\/a>/);
  assert.match(css, /\.skip-link:focus\s*\{\s*top:\s*8px;/);
});

test('los cinco diálogos son role=dialog, aria-modal y tienen etiqueta', () => {
  for (const [id, label] of [
    ['compare-modal', 'modal-product-name'],
    ['cart-drawer-backdrop', 'cart-drawer-title'],
    ['checkout-modal', 'checkout-title'],
    ['report-modal', 'report-title'],
    ['scan-modal', 'scan-title'],
  ]) {
    const tag = html.slice(html.indexOf(`id="${id}"`) - 6, html.indexOf(`id="${id}"`) + 240);
    assert.match(tag, /role="dialog"/, id);
    assert.match(tag, /aria-modal="true"/, id);
    assert.match(tag, new RegExp(`aria-labelledby="${label}"`), id);
  }
});

test('controles y estados tienen nombre accesible', () => {
  assert.match(html, /id="main-search-input"[\s\S]{0,120}aria-label="Buscar productos/);
  assert.match(html, /id="main-search-input"[\s\S]{0,220}role="combobox"/);
  assert.match(html, /id="main-search-input"[\s\S]{0,260}aria-expanded="false"/);
  assert.match(html, /id="search-suggestions"[\s\S]{0,80}role="listbox"/);
  assert.match(html, /id="scan-btn"[\s\S]{0,160}aria-label="Escanear código de barras"/);
  assert.match(html, /id="sort-select" aria-label="Ordenar resultados"/);
  assert.match(html, /id="results-count" aria-live="polite"/);
  assert.match(html, /id="category-filters" role="group" aria-label="Filtrar por categoría"/);
  assert.match(html, /id="toast" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /aria-pressed="false"/);
});

test('el acordeón expone aria-expanded y aria-controls', () => {
  assert.equal((html.match(/class="accordion-trigger/g) || []).length, 3);
  assert.equal((html.match(/aria-controls="faq-/g) || []).length, 3);
  assert.equal((html.match(/id="faq-[123]" role="region"/g) || []).length, 3);
  assert.match(html, /aria-expanded="false" aria-controls="faq-1"/);
});

test('todos los SVG estáticos son decorativos', () => {
  const all = (html.match(/<svg\s/g) || []).length;
  const hidden = (html.match(/<svg aria-hidden="true"/g) || []).length;
  assert.ok(all > 0);
  assert.equal(all, hidden);
});

test('el foco visible y reduced-motion están en styles.css', () => {
  assert.match(
    css,
    /body :focus-visible\s*\{[\s\S]*?outline: 2px solid var\(--color-yellow\) !important/
  );
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /scroll-behavior: auto !important/);
});

test('las tarjetas son enfocables y usan listeners delegados', () => {
  assert.match(ui, /role="button" tabindex="0" aria-label="Comparar/);
  assert.match(ui, /grid\.onclick = /);
  assert.match(ui, /grid\.onkeydown = /);
  assert.match(ui, /decoding="async"/);
});

test('el módulo a11y expone las primitivas sin ejecutar DOM al importarlo', () => {
  for (const fn of [visibleFocusables, openDialog, closeDialog, trapDialogTab]) {
    assert.equal(typeof fn, 'function');
  }
});
