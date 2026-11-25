/**
 * UP · Selección de hasta 3 productos para comparar (FASE U4).
 * La selección vive en memoria durante la navegación: no guarda datos personales.
 */
import { $ } from './utils.js';
import { MAX_COMPARE_PRODUCTS, toggleComparison } from './compare-products.js';

let ids = [];
let bound = false;

function render() {
  const bar = $('compare-bar');
  if (!bar) return;
  bar.hidden = ids.length === 0;
  const count = $('compare-bar-count');
  if (count) count.textContent = `${ids.length}/${MAX_COMPARE_PRODUCTS} productos seleccionados`;
  document.querySelectorAll('[data-compare-select]').forEach((button) => {
    const selected = ids.includes(button.dataset.compareSelect);
    button.setAttribute('aria-pressed', String(selected));
    button.textContent = selected ? 'En comparación ✓' : 'Comparar hasta 3';
  });
}

export function initComparePicker() {
  if (bound) return;
  bound = true;
  $('compare-bar-open')?.addEventListener('click', () => {
    if (ids.length) globalThis.location.hash = '#/comparar';
  });
  $('compare-bar-clear')?.addEventListener('click', () => {
    ids = [];
    render();
  });
  render();
}

export function getComparisonIds() {
  return [...ids];
}

export function isInComparison(productId) {
  return ids.includes(productId);
}

export function removeFromComparisonId(productId) {
  ids = ids.filter((id) => id !== productId);
  render();
}

export function toggleProductInComparison(productId, notify = () => {}) {
  const result = toggleComparison(ids, productId);
  if (result.reason === 'limite') {
    notify(`Puedes comparar hasta ${MAX_COMPARE_PRODUCTS} productos a la vez`);
    return result;
  }
  ids = result.ids;
  render();
  return result;
}
