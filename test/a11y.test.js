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

test('los seis diálogos son role=dialog, aria-modal y tienen etiqueta', () => {
  for (const [id, label] of [
    ['compare-modal', 'modal-product-name'],
    ['cart-drawer-backdrop', 'cart-drawer-title'],
    ['checkout-modal', 'checkout-title'],
    ['report-modal', 'report-title'],
    ['scan-modal', 'scan-title'],
    ['list-add-modal', 'list-add-title'],
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
  assert.match(
    ui,
    /<button type="button" aria-label="Comparar precios de[^>]*class="up-compare-btn" data-compare=/
  );
  assert.match(ui, /grid\.onclick = /);
  assert.match(ui, /grid\.onkeydown = /);
  assert.match(ui, /decoding="async"/);
});

test('el checkout U5 no pide tarjeta y ofrece comprobante imprimible', () => {
  assert.match(html, /name="payment-method" value="simulado" checked/);
  assert.doesNotMatch(html, /name="payment-method" value="tarjeta"/);
  assert.match(html, /id="toast-action" class="up-toast-action" hidden/);
  assert.match(html, /id="checkout-fee-info"[\s\S]{0,220}aria-expanded="false"/);
  assert.match(html, /id="checkout-fee-help" class="up-tooltip" role="tooltip" hidden/);
  assert.match(html, /id="print-receipt-btn"/);
  assert.match(css, /@media print/);
});

test('U6 conserva diálogos etiquetados, nav accesible y encuesta de un clic', () => {
  assert.match(
    html,
    /id="onboarding-modal"[\s\S]{0,140}role="dialog"[\s\S]{0,80}aria-modal="true"/
  );
  assert.match(html, /aria-labelledby="onboarding-title"/);
  assert.match(
    html,
    /id="bottom-nav" class="up-bottom-nav" aria-label="Navegación principal móvil"/
  );
  assert.match(html, /id="checkout-survey" class="up-survey"/);
  assert.match(html, /id="checkout-survey-note"[^>]*aria-live="polite"/);
  assert.match(css, /\.up-bottom-nav a\[aria-current='page'\]/);
  assert.match(css, /min-height: 56px/);
});

test('U7 conserva foco visible, reduced motion, aviso de privacidad y estados accesibles', () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(html, /<html lang="es-CL">/);
  assert.match(html, /id="privacy-banner"[\s\S]{0,120}aria-labelledby="privacy-title"/);
  assert.match(html, /id="privacy-banner"[\s\S]{0,160}hidden/);
  assert.match(css, /\.up-privacy-banner:not\(\[hidden\]\)/);
  assert.match(html, /data-open-privacy/);
  assert.match(html, /<script src="data\/demo\.js" defer>/);
  assert.match(html, /<script src="data\/product-images\.js" defer>/);
  assert.match(ui, /alt="Imagen de \$\{esc\(product\.name\)\}"/);
  assert.match(css, /\.up-skeleton-card/);
  assert.match(css, /\.up-state-error/);
});

test('el módulo a11y expone las primitivas sin ejecutar DOM al importarlo', () => {
  for (const fn of [visibleFocusables, openDialog, closeDialog, trapDialogTab]) {
    assert.equal(typeof fn, 'function');
  }
});
