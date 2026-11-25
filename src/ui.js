/**
 * UP · Render, toasts y avisos descartables.
 * Toda la manipulación del DOM de la demo vive aquí.
 */
import { $, esc, formatCLP, getProductSVG, safeAssetUrl } from './utils.js';
import { STATIC_DEMO, STORES } from './config.js';
import { state, getLinkVerification, hasReindex } from './state.js';
import {
  effectiveSku,
  getConfirmedProductStats,
  getProductStats,
  unitPriceFor,
} from './catalog.js';
import { freshnessFor, isVerifiedFresh } from './freshness.js';
import { loadState, updateState } from './storage.js';
import { isFavorite, toggleFavorite } from './favorites.js';
import { isInComparison, toggleProductInComparison } from './compare-picker.js';
import { approximateMatch, didYouMean, highlightMatch } from './suggest.js';
import { offerLink, reindexKey } from './links.js';
import {
  addToCart,
  calculateCartTotals,
  clearCartItems,
  getUndoState,
  loadSavedCartItems,
  removeFromCart,
  undoLastCartChange,
  updateCartQty,
} from './cart.js';
import { cartSavings } from './cart-savings.js';
import { addSavedCart, findSavedCart, makeSavedCart, removeSavedCart } from './saved-carts.js';
import { sortByPreferences } from './preferences.js';
import { openDialog, closeDialog } from './a11y.js';
import {
  activeFilterChips,
  AVAILABILITY_OPTIONS,
  DELIVERY_OPTIONS,
  facetCounts,
  hasConfirmedPrice,
  hasOffer,
  matchesFilters,
  sortProducts,
  priceForDisplay,
  priceBounds,
  syncFreeShippingFilter,
} from './filters.js';

const uiHooks = { onOpenCompare: () => {}, onAddToList: () => {} };
const cardQuantities = new Map();
const PAGE_SIZE = 12;
let visibleLimit = PAGE_SIZE;
let toastTimer;

export function initUI(nextHooks = {}) {
  uiHooks.onOpenCompare = nextHooks.onOpenCompare || uiHooks.onOpenCompare;
  uiHooks.onAddToList = nextHooks.onAddToList || uiHooks.onAddToList;
  bindCartTools();
}

function bindCartTools() {
  $('cart-undo').addEventListener('click', () => undoLastCartChange());
  $('cart-clear').addEventListener('click', () => clearCartItems());
  $('cart-save').addEventListener('click', () => {
    const savedCarts = loadState().savedCarts || [];
    const name = `Carrito ${savedCarts.length + 1} · ${new Date().toLocaleDateString('es-CL')}`;
    const saved = makeSavedCart({ name, items: state.cart });
    if (!saved) {
      showToast('Agrega productos antes de guardar el carrito');
      return;
    }
    updateState((current) => {
      current.savedCarts = addSavedCart(current.savedCarts, saved);
    });
    showToast(`Carrito guardado: ${name}`);
    renderCartUI();
  });

  $('saved-carts-list').addEventListener('click', (event) => {
    const loadButton = event.target.closest('[data-saved-load]');
    const removeButton = event.target.closest('[data-saved-remove]');
    if (loadButton) {
      const saved = findSavedCart(loadState().savedCarts, loadButton.dataset.savedLoad);
      if (!loadSavedCartItems(saved?.items))
        showToast('Ese carrito guardado ya no está disponible');
      return;
    }
    if (removeButton) {
      updateState((current) => {
        current.savedCarts = removeSavedCart(current.savedCarts, removeButton.dataset.savedRemove);
      });
      showToast('Carrito guardado eliminado');
      renderCartUI();
    }
  });
}

/** La paginación es solo presentación: las tarjetas siguen en el DOM. */
export function resetProductPaging() {
  visibleLimit = PAGE_SIZE;
}

export function showMoreProducts() {
  visibleLimit += PAGE_SIZE;
  updateProductVisibility();
}

function updateProductVisibility() {
  const cards = Array.from(document.querySelectorAll('#product-grid .up-product-card'));
  cards.forEach((card, index) => {
    card.hidden = index >= visibleLimit;
  });
  const button = document.querySelector('#load-more-btn');
  if (!button) return;
  const remaining = Math.max(0, cards.length - visibleLimit);
  button.hidden = remaining === 0;
  button.setAttribute('aria-label', remaining ? `Cargar más (${remaining})` : 'Cargar más');
  const label = button.querySelector('[data-load-more-label]');
  if (label) label.textContent = remaining ? `Cargar más (${remaining})` : 'Cargar más';
}

export function hideToast() {
  clearTimeout(toastTimer);
  $('toast')?.classList.add('up-toast-out');
  const action = $('toast-action');
  if (action) {
    action.hidden = true;
    action.onclick = null;
  }
}

/**
 * Aviso accesible con acción opcional (usado por Deshacer).
 * Mantiene intacto el contenedor role="status" aria-live="polite" aria-atomic="true".
 */
export function showToast(msg, { actionLabel = '', onAction = null, timeout = 2800 } = {}) {
  const toast = $('toast');
  const action = $('toast-action');
  $('toast-message').textContent = msg;
  if (typeof onAction === 'function' && actionLabel) {
    action.textContent = actionLabel;
    action.hidden = false;
    action.onclick = () => {
      hideToast();
      onAction();
    };
  } else {
    action.hidden = true;
    action.onclick = null;
  }
  toast.classList.remove('up-toast-out');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, timeout);
}

const CATEGORY_ICONS = {
  TODOS:
    '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>',
  'Bebidas y Licores':
    '<path d="M5 4h10l-1 12H6L5 4Z" stroke-linejoin="round"/><path d="M4 4h12"/>',
  'Lácteos y Frescos': '<path d="M7 7h6v10H7z" stroke-linejoin="round"/><path d="M7 7l3-3 3 3"/>',
  'Almacén / Despensa':
    '<path d="M4 7h12v10H4z" stroke-linejoin="round"/><path d="M4 7l2-3h8l2 3"/>',
  'Frutas y Verduras':
    '<path d="M16 4C9 4 4 8 4 13a3 3 0 0 0 3 3c5 0 9-5 9-12Z" stroke-linejoin="round"/><path d="M7 16c1-4 4-7 8-9"/>',
  Carnes:
    '<path d="M6 7a5 5 0 0 1 8 0l3 3-5 5-6-6Z" stroke-linejoin="round"/><circle cx="8" cy="8" r="1"/>',
  'Aseo y Limpieza':
    '<path d="M10 3v14M5 7l10 8M15 7L5 15" stroke-linecap="round"/><circle cx="10" cy="10" r="7"/>',
  Congelados:
    '<path d="M10 3v14M4.5 6.5l11 7M15.5 6.5l-11 7" stroke-linecap="round"/><path d="M8 5l2 2 2-2M8 15l2-2 2 2"/>',
  Mascotas:
    '<circle cx="6" cy="8" r="1.5"/><circle cx="10" cy="5.5" r="1.5"/><circle cx="14" cy="8" r="1.5"/><path d="M10 10c-3 0-5 2-5 4s2 2 5 2 5 0 5-2-2-4-5-4Z"/>',
  'Cuidado Personal':
    '<path d="M10 16s-6-3.5-6-8a3.5 3.5 0 0 1 6-2.5A3.5 3.5 0 0 1 16 8c0 4.5-6 8-6 8Z" stroke-linejoin="round"/>',
};

function categoryIcon(category) {
  const paths = CATEGORY_ICONS[category] || CATEGORY_ICONS.TODOS;
  return `<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">${paths}</svg>`;
}

export function renderCategories() {
  const container = $('category-filters');
  container.innerHTML = state.categories
    .map((cat) => {
      const active = state.selectedCategory === cat;
      return `
      <button type="button" data-category="${esc(cat)}" aria-pressed="${active}" class="up-category${
        active ? ' up-active' : ''
      }">
        ${categoryIcon(cat)}
        <span>${esc(cat)}</span>
      </button>`;
    })
    .join('');

  container.querySelectorAll('.up-category').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedCategory = btn.dataset.category;
      renderCategories();
      renderProducts();
    });
  });
}

export function renderChainStrip() {
  const strip = $('chain-strip');
  if (!strip) return;
  strip.innerHTML = Object.values(STORES)
    .map(
      (store) => `
      <div class="up-chain">
        <span class="up-chain-dot" aria-hidden="true"></span>
        <span class="up-chain-name">${esc(store.name)}</span>
        <span class="up-chain-threshold">Despacho gratis desde ${formatCLP(store.freeShippingThreshold)}</span>
      </div>`
    )
    .join('');
}

function choiceMarkup(kind, value, label, count, active) {
  return `
    <button
      type="button"
      class="up-choice${active ? ' up-active' : ''}"
      data-filter-choice="${kind}"
      data-filter-value="${esc(String(value))}"
      aria-pressed="${active}"
      ${!count && !active ? 'disabled' : ''}
    >
      <span>${esc(label)}</span>
      <span class="up-facet-count">${count}</span>
    </button>`;
}

export function renderChainFilter() {
  const counts = facetCounts().chain;
  const containers = document.querySelectorAll(
    '[data-filter-options="chain"], [data-filter-options="chain-sheet"]'
  );
  containers.forEach((container) => {
    container.innerHTML = [
      ['TODOS', 'Todas las cadenas'],
      ...Object.values(STORES).map((store) => [store.id, store.name]),
    ]
      .map(([id, label]) =>
        choiceMarkup('chain', id, label, counts[id] || 0, state.selectedChain === id)
      )
      .join('');
  });
}

export function updateFreeShippingButton() {
  document.querySelectorAll('[data-toggle-filter="shipping"]').forEach((button) => {
    button.setAttribute('aria-pressed', String(state.freeShippingOnly));
    button.classList.toggle('up-active', state.freeShippingOnly);
  });
}

/** Mantiene los dos ranges, la barra de relleno y el texto de precio en sync. */
export function syncPriceRange() {
  const bounds = priceBounds();
  const lo = state.minPrice > 0 ? state.minPrice : bounds.min;
  const hi = Number.isFinite(state.maxPrice) ? state.maxPrice : bounds.max;

  document.querySelectorAll('[data-range-input]').forEach((input) => {
    input.min = String(bounds.min);
    input.max = String(bounds.max);
    input.step = '100';
    if (document.activeElement !== input) {
      input.value = String(input.dataset.rangeInput === 'min' ? lo : hi);
    }
  });

  document.querySelectorAll('[data-range-slider]').forEach((slider) => {
    const start = Math.min(lo, hi);
    const end = Math.max(lo, hi);
    const span = Math.max(1, bounds.max - bounds.min);
    const fill = slider.querySelector('[data-range-fill]');
    if (fill) {
      fill.style.left = `${((start - bounds.min) / span) * 100}%`;
      fill.style.width = `${((end - start) / span) * 100}%`;
    }
    const readout = slider.parentElement.querySelector('[data-range-value]');
    if (readout) readout.textContent = `${formatCLP(start)} – ${formatCLP(end)}`;
  });
}

export function renderFilterControls() {
  const counts = facetCounts();
  const bounds = priceBounds();

  document.querySelectorAll('input[data-filter-input="min-price"]').forEach((input) => {
    input.min = String(bounds.min);
    input.max = String(bounds.max);
    if (document.activeElement !== input)
      input.value = state.minPrice ? String(state.minPrice) : '';
  });
  document.querySelectorAll('input[data-filter-input="max-price"]').forEach((input) => {
    input.min = String(bounds.min);
    input.max = String(bounds.max);
    input.placeholder = 'Sin límite';
    if (document.activeElement !== input) {
      input.value = Number.isFinite(state.maxPrice) ? String(state.maxPrice) : '';
    }
  });

  document
    .querySelectorAll('[data-filter-options="delivery"], [data-filter-options="delivery-sheet"]')
    .forEach((container) => {
      container.innerHTML = DELIVERY_OPTIONS.map((option) =>
        choiceMarkup(
          'delivery',
          option.value,
          option.label,
          counts.delivery[String(option.value)] || 0,
          state.maxDelivery === option.value
        )
      ).join('');
    });

  document
    .querySelectorAll(
      '[data-filter-options="availability"], [data-filter-options="availability-sheet"]'
    )
    .forEach((container) => {
      container.innerHTML = AVAILABILITY_OPTIONS.map((option) =>
        choiceMarkup(
          'availability',
          option.value,
          option.label,
          counts.availability[option.value] || 0,
          state.availability === option.value
        )
      ).join('');
    });

  document.querySelectorAll('[data-toggle-filter="offers"]').forEach((button) => {
    button.setAttribute('aria-pressed', String(state.offersOnly));
    button.classList.toggle('up-active', state.offersOnly);
  });
  updateFreeShippingButton();
  syncPriceRange();

  const productWord = counts.all === 1 ? 'producto' : 'productos';
  document.querySelectorAll('[data-count-for="price"]').forEach((el) => {
    el.textContent = `${counts.all} ${productWord} en este rango`;
  });
  document.querySelectorAll('[data-count-for="offers"]').forEach((el) => {
    el.textContent = counts.offers;
  });
  document.querySelectorAll('[data-count-for="shipping"]').forEach((el) => {
    el.textContent = counts.shipping;
  });
  document.querySelectorAll('[data-count-for="all"]').forEach((el) => {
    el.textContent = counts.all;
  });

  const activeCounts = {
    chain: state.selectedChain !== 'TODOS' ? '1' : '',
    price: state.minPrice > 0 || Number.isFinite(state.maxPrice) ? '1' : '',
    offers: state.offersOnly ? '1' : '',
    shipping: state.freeShippingOnly ? '1' : '',
    delivery: state.maxDelivery > 0 ? '1' : '',
    availability: state.availability !== 'TODOS' ? '1' : '',
  };
  document.querySelectorAll('[data-active-count]').forEach((el) => {
    const text = activeCounts[el.dataset.activeCount] || '';
    el.textContent = text;
    el.hidden = !text;
  });

  const chips = activeFilterChips();
  $('active-filters').innerHTML = chips
    .map(
      (chip) => `
      <span class="up-filter-chip">
        ${esc(chip.label)}
        <button type="button" data-clear-filter="${chip.key}" aria-label="Quitar filtro ${esc(chip.label)}">✕</button>
      </span>`
    )
    .join('');
  $('clear-filters-btn').classList.toggle('hidden', chips.length === 0);
}

export function openFilterSheet() {
  openDialog($('filter-sheet-backdrop'), 'close-filter-sheet-btn');
}

export function closeFilterSheet() {
  closeDialog($('filter-sheet-backdrop'));
}

function quantityFor(productId) {
  return cardQuantities.get(productId) || 1;
}

/** Sello de frescura: nunca afirma "actualizado" si la oferta no está verificada. */
export function freshnessBadge(product, storeId, { compact = false } = {}) {
  if (!storeId) return '';
  const sku = effectiveSku(product, storeId, loadState().overrides);
  const fresh = freshnessFor(sku);
  let tone = fresh.tone;
  let text = fresh.label;
  if (fresh.stale) {
    tone = 'warning';
    text = 'Precio desactualizado';
  } else if (!isVerifiedFresh(sku)) {
    tone = 'neutral';
    text = 'Sin confirmar';
  }
  return `<span class="up-fresh up-fresh--${tone}">${esc(compact && text.startsWith('Actualizado') ? fresh.shortLabel : text)}</span>`;
}

function infoTip(label, text) {
  return `<span class="up-info" tabindex="0" role="img" aria-label="${esc(label)}: ${esc(text)}">ⓘ<span class="up-info-pop" role="tooltip">${esc(text)}</span></span>`;
}

export function renderProducts() {
  const grid = $('product-grid');
  const emptyState = $('empty-state');
  const countEl = $('results-count');

  const sorted = sortProducts(state.products.filter(matchesFilters));
  const filtered =
    state.sortBy === 'default' ? sortByPreferences(sorted, loadState().preferences) : sorted;
  const productWord = filtered.length === 1 ? 'producto' : 'productos';

  countEl.textContent = `${filtered.length} ${productWord}`;

  if (!filtered.length) {
    grid.innerHTML = '';
    emptyState.classList.remove('hidden');
    const query = state.searchQuery.trim();
    const correction = didYouMean(query, state.products);
    // Con errores de tipeo, las categorías se derivan de productos cercanos:
    // suggestionsFor() sólo devuelve coincidencias exactas de categoría.
    const related = state.products.filter(
      (product) =>
        approximateMatch(query, product.name) ||
        (correction && approximateMatch(correction, product.name))
    );
    const categories = [...new Set(related.map((product) => product.category))].slice(0, 4);
    emptyState.innerHTML = `
      <svg aria-hidden="true" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M18 22h28l4 28H14l4-28Z" stroke-linejoin="round" />
        <path d="M24 22v-5a8 8 0 0 1 16 0v5" stroke-linecap="round" />
      </svg>
      <h3>No encontramos “${esc(query || 'ese producto')}”</h3>
      <p>Prueba con otro término, quita filtros o explora una categoría relacionada.</p>
      ${
        correction
          ? `<p class="up-empty-correction">¿Quisiste decir <button type="button" data-empty-suggestion="${esc(correction)}">${esc(correction)}</button>?</p>`
          : ''
      }
      ${
        categories.length
          ? `<div class="up-empty-categories" role="group" aria-label="Categorías relacionadas">${categories
              .map(
                (category) =>
                  `<button type="button" data-empty-suggestion="${esc(category)}">${esc(category)}</button>`
              )
              .join('')}</div>`
          : ''
      }
      <button id="reset-filters-btn" type="button" class="up-btn-primary">Limpiar filtros</button>`;
    const loadMore = document.querySelector('#load-more-btn');
    if (loadMore) loadMore.hidden = true;
    return;
  }
  emptyState.classList.add('hidden');

  grid.innerHTML = filtered
    .map((product) => {
      const shown = priceForDisplay(product);
      const stats = getProductStats(product);
      const unit = unitPriceFor(product, shown.price);
      const image = safeAssetUrl(product.image);
      const qty = quantityFor(product.id);
      const confirmedBest =
        shown.best &&
        getConfirmedProductStats(product, { overrides: loadState().overrides }).minPrice ===
          shown.price;
      const badges = [
        confirmedBest
          ? '<span class="up-badge up-badge--best">Mejor precio</span>'
          : shown.best
            ? '<span class="up-badge up-badge--referential">Precio referencial</span>'
            : '',
        hasOffer(product) ? '<span class="up-badge up-badge--offer">Oferta</span>' : '',
        hasConfirmedPrice(product)
          ? '<span class="up-badge up-badge--verified">Precio verificado</span>'
          : '',
        freshnessBadge(product, shown.store?.id, { compact: true }),
      ].join('');

      return `
      <article data-product-id="${esc(product.id)}" class="up-product-card">
        <a class="up-card-media" href="#/producto/${encodeURIComponent(product.id)}" aria-label="Ver detalle de ${esc(product.name)} · (${esc(product.index)}) ${esc(product.category)}">
          <span class="up-card-index">(${esc(product.index)})</span>
          <span class="up-card-category">${highlightMatch(product.category, state.searchQuery)}</span>
          ${
            image
              ? `<img src="${esc(image)}" alt="" width="240" height="240" loading="lazy" decoding="async" />`
              : getProductSVG(product.icon)
          }
        </a>

        <div class="up-card-body">
          <div class="up-card-badges">${badges}</div>
          <h3 class="up-card-name"><a href="#/producto/${encodeURIComponent(product.id)}">${highlightMatch(product.name, state.searchQuery)}</a></h3>
          <p class="up-card-unit">
            <span>${esc(product.unit)}</span>
            ${infoTip('Detalle técnico', 'Presentación y unidad usadas para calcular el precio por kg o litro.')}
          </p>

          <div class="up-card-price">
            <div>
              <span class="up-card-price-label">${
                confirmedBest
                  ? 'DESDE'
                  : shown.best
                    ? 'MENOR PRECIO REFERENCIAL'
                    : `PRECIO EN ${shown.store ? esc(shown.store.short) : '—'}`
              }</span>
              <strong class="price">${formatCLP(shown.price)}</strong>
            </div>
            <span class="up-card-store">${shown.store ? esc(shown.store.name) : '—'}</span>
          </div>

          <div class="up-price-strip" role="group" aria-label="Precios por supermercado">
            ${stats.sorted
              .slice(0, 5)
              .map(
                (entry) => `
                <span class="up-mini-price${
                  shown.store && entry.storeId === shown.store.id ? ' up-mini-price--best' : ''
                }">
                  <small>${esc(entry.store.short)}</small>
                  <b class="price">${formatCLP(entry.price)}</b>
                </span>`
              )
              .join('')}
          </div>

          ${
            unit
              ? `<p class="up-card-unit-price">${formatCLP(unit.value)} ${esc(unit.label)} ${infoTip(
                  'Precio unitario',
                  'Cálculo de demostración a partir del precio y la presentación del producto.'
                )}</p>`
              : ''
          }

          <div class="up-card-actions">
            <div class="up-qty" role="group" aria-label="Cantidad de ${esc(product.name)}">
              <button type="button" data-card-qty="${esc(product.id)}" data-card-delta="-1" aria-label="Disminuir cantidad">−</button>
              <span data-card-qty-value aria-live="polite">${qty}</span>
              <button type="button" data-card-qty="${esc(product.id)}" data-card-delta="1" aria-label="Aumentar cantidad">+</button>
            </div>
            <button
              type="button"
              class="up-btn-primary up-add-btn"
              data-add-to-cart="${esc(product.id)}"
              data-add-store="${shown.store ? esc(shown.store.id) : ''}"
              ${shown.store ? '' : 'disabled'}
            >
              Agregar
            </button>
            <button
              type="button"
              class="up-btn-secondary up-add-list-btn"
              data-add-to-list="${esc(product.id)}"
              aria-label="Agregar ${esc(product.name)} a mi lista"
            >
              Mi lista
            </button>
            <button
              type="button"
              class="up-btn-secondary up-favorite-btn"
              data-favorite="${esc(product.id)}"
              aria-pressed="${isFavorite(loadState(), product.id)}"
              aria-label="${isFavorite(loadState(), product.id) ? 'Quitar' : 'Agregar'} ${esc(product.name)} ${isFavorite(loadState(), product.id) ? 'de' : 'a'} favoritos"
            >
              ${isFavorite(loadState(), product.id) ? '♥ Favorito' : '♡ Favorito'}
            </button>
          </div>

          <div class="up-card-compare-actions">
            <button type="button" aria-label="Comparar precios de ${esc(product.name)}" class="up-compare-btn" data-compare="${esc(product.id)}">
              Comparar precios
              <span aria-hidden="true">→</span>
            </button>
            <button
              type="button"
              class="up-btn-secondary up-compare-select-btn"
              data-compare-select="${esc(product.id)}"
              aria-pressed="${isInComparison(product.id)}"
            >
              ${isInComparison(product.id) ? 'En comparación ✓' : 'Comparar hasta 3'}
            </button>
          </div>
        </div>
      </article>`;
    })
    .join('');

  updateProductVisibility();

  // Delegación: 2 listeners para todas las tarjetas, sin importar cuántas haya.
  grid.onclick = (e) => {
    const qtyBtn = e.target.closest('[data-card-qty]');
    if (qtyBtn) {
      e.stopPropagation();
      const id = qtyBtn.dataset.cardQty;
      const next = Math.max(1, Math.min(99, quantityFor(id) + Number(qtyBtn.dataset.cardDelta)));
      cardQuantities.set(id, next);
      const card = qtyBtn.closest('.up-product-card');
      const value = card && card.querySelector('[data-card-qty-value]');
      if (value) value.textContent = next;
      return;
    }

    const addBtn = e.target.closest('[data-add-to-cart]');
    if (addBtn && addBtn.dataset.addStore) {
      e.stopPropagation();
      const id = addBtn.dataset.addToCart;
      const qty = quantityFor(id);
      cardQuantities.set(id, 1);
      addToCart(id, addBtn.dataset.addStore, qty);
      const card = grid.querySelector(`[data-product-id="${id}"]`);
      const value = card && card.querySelector('[data-card-qty-value]');
      if (value) value.textContent = 1;
      return;
    }

    const listBtn = e.target.closest('[data-add-to-list]');
    if (listBtn) {
      e.stopPropagation();
      const id = listBtn.dataset.addToList;
      uiHooks.onAddToList(id, quantityFor(id));
      return;
    }

    const favoriteBtn = e.target.closest('[data-favorite]');
    if (favoriteBtn) {
      e.stopPropagation();
      const id = favoriteBtn.dataset.favorite;
      const added = updateState((saved) => toggleFavorite(saved, id, state.products));
      if (added !== null)
        showToast(added ? 'Producto agregado a favoritos' : 'Producto quitado de favoritos');
      renderProducts();
      return;
    }

    const selectBtn = e.target.closest('[data-compare-select]');
    if (selectBtn) {
      e.stopPropagation();
      toggleProductInComparison(selectBtn.dataset.compareSelect, showToast);
      renderProducts();
      return;
    }

    const compareBtn = e.target.closest('[data-compare]');
    if (compareBtn) {
      uiHooks.onOpenCompare(compareBtn.dataset.compare);
      return;
    }

    // La imagen y el nombre son enlaces al detalle; el botón "Comparar
    // precios" conserva el modal existente.
  };
  grid.onkeydown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('button, a')) return;
    const card = e.target.closest('.up-product-card');
    if (!card) return;
    e.preventDefault();
    window.location.hash = `#/producto/${encodeURIComponent(card.dataset.productId)}`;
  };
}

export function linkMarkup(product, chainId) {
  const link = offerLink(product, chainId);
  const v = link.canonical && link.url ? getLinkVerification(link.url) : null;
  const broken = !!(v && !v.loading && !v.ok && !v.paused);
  const verified = !!(v && !v.loading && v.ok);
  const pending = hasReindex(reindexKey(product.id, chainId));

  let stateText = 'Sin SKU mapeado';
  let stateAttr = 'none';
  let action = pending ? 'data-reindex' : '';
  if (STATIC_DEMO && link.canonical && link.url) {
    stateText = 'Demo · sin verificación';
    stateAttr = 'demo';
    action = '';
  } else if (broken) {
    stateText = '⚠ Enlace roto · reindexar';
    stateAttr = 'broken';
    action = 'data-reindex';
  } else if (verified) {
    stateText = 'Verificado ✓';
    stateAttr = 'ok';
    action = '';
  } else if (v && v.paused) {
    stateText = 'Verificación en pausa';
    stateAttr = 'search';
    action = '';
  } else if (v && v.loading) {
    stateText = 'Verificando…';
    stateAttr = 'loading';
    action = '';
  } else if (link.canonical && link.url) {
    stateText = 'Verificar';
    stateAttr = 'verify';
    action = 'data-verify';
  } else if (!link.url && link.token) {
    stateText = 'Búsqueda SKU exacta';
    stateAttr = 'search';
    action = '';
  } else if (pending) {
    stateText = 'En cola de re-indexación';
    stateAttr = 'search';
    action = 'data-reindex';
  }

  return {
    broken,
    html: `
      ${
        link.url
          ? `<a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" class="up-store-link"><span>Ver en tienda</span><span aria-hidden="true">↗</span></a>
      <span class="up-store-token">${link.kind === 'ficha' ? 'Ficha' : 'SKU/GTIN'} ${esc(link.token || '—')}</span>`
          : ''
      }
      <button type="button" class="verify-badge" data-state="${stateAttr}" data-chain="${esc(chainId)}" ${action ? `${action}="${esc(action === 'data-reindex' ? reindexKey(product.id, chainId) : link.url)}"` : ''}>${stateText}</button>
      ${broken ? '<span class="up-unconfirmed-inline">Precio no confirmado</span>' : ''}`,
  };
}

export function renderCartUI() {
  const totals = calculateCartTotals();
  const { storeGroups, totalItems, productsSubtotal, totalShipping, upFee, grandTotal } = totals;

  $('nav-cart-count').textContent = totalItems;
  $('nav-cart-total').textContent = formatCLP(grandTotal);
  $('open-cart-btn').setAttribute(
    'aria-label',
    `Abrir carrito · Carrito ${totalItems} ${formatCLP(grandTotal)}`
  );

  const dock = $('bottom-dock');
  if (totalItems > 0) {
    dock.classList.remove('hidden');
    $('dock-summary').textContent =
      `${totalItems} PROD · ${storeGroups.length} SUPERMERCADO${storeGroups.length > 1 ? 'S' : ''}`;
    $('dock-total').textContent = formatCLP(grandTotal);
  } else {
    dock.classList.add('hidden');
  }

  const container = $('cart-items-container');
  const checkoutBtn = $('checkout-btn');

  if (!storeGroups.length) {
    container.innerHTML = `
      <div class="up-cart-empty">
        <span class="up-cart-empty-icon" aria-hidden="true">UP</span>
        <h3>Tu carrito está vacío</h3>
        <p>Agrega productos desde el catálogo para comparar precios entre supermercados.</p>
      </div>`;
    checkoutBtn.disabled = true;
  } else {
    checkoutBtn.disabled = false;
    container.innerHTML = storeGroups
      .map(
        (group) => `
      <section class="up-cart-group" aria-label="Carrito ${esc(group.store.name)}">
        <header class="up-cart-group-head">
          <div>
            <span class="up-eyebrow">SUPERMERCADO</span>
            <h3>${esc(group.store.name)}</h3>
          </div>
          <strong class="price">${formatCLP(group.subtotal)}</strong>
        </header>

        <div class="up-cart-progress-wrap">
          <div class="up-cart-progress-copy">
            ${
              group.isFreeShipping
                ? `<span class="up-cart-progress-ok">✓ Despacho gratis desbloqueado</span>`
                : `<span>Agrega <strong class="price">${formatCLP(group.missingForFree)}</strong> para despacho gratis</span>`
            }
            <span class="price">${group.progressPct}%</span>
          </div>
          <div
            class="up-cart-progress"
            role="progressbar"
            aria-label="Progreso de despacho gratis en ${esc(group.store.name)}"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="${group.progressPct}"
          >
            <div class="up-cart-progress-bar${group.isFreeShipping ? ' up-cart-progress-bar--full' : ''}" style="width: ${group.progressPct}%"></div>
          </div>
        </div>

        <ul class="up-cart-items">
          ${group.items
            .map((item) => {
              const image = safeAssetUrl(item.product.image);
              const thumb = image
                ? `<img src="${esc(image)}" alt="" width="56" height="56" loading="lazy" decoding="async" />`
                : `<span aria-hidden="true">${esc(item.product.category.slice(0, 1).toUpperCase())}</span>`;
              return `
              <li class="up-cart-item">
                <span class="up-cart-thumb" aria-hidden="true">${thumb}</span>
                <div class="up-cart-item-info">
                  <p>${esc(item.product.name)}</p>
                  <span>${formatCLP(item.unitPrice)} c/u</span>
                </div>
                <div class="up-cart-item-controls">
                  <div class="up-qty" role="group" aria-label="Cantidad de ${esc(item.product.name)}">
                    <button type="button" data-qty-key="${esc(item.key)}" data-delta="-1" aria-label="Disminuir ${esc(item.product.name)}" class="cart-qty-btn">−</button>
                    <span aria-live="polite">${item.qty}</span>
                    <button type="button" data-qty-key="${esc(item.key)}" data-delta="1" aria-label="Aumentar ${esc(item.product.name)}" class="cart-qty-btn">+</button>
                  </div>
                  <button type="button" data-remove-key="${esc(item.key)}" aria-label="Eliminar ${esc(item.product.name)}" class="cart-remove-btn">✕</button>
                </div>
              </li>`;
            })
            .join('')}
        </ul>

        <footer class="up-cart-group-foot">
          <span>Despacho ${esc(group.store.name)}</span>
          <strong>${group.isFreeShipping ? 'Gratis' : formatCLP(group.shipping)}</strong>
        </footer>
      </section>`
      )
      .join('');

    container.querySelectorAll('.cart-qty-btn').forEach((btn) => {
      btn.addEventListener('click', () =>
        updateCartQty(btn.dataset.qtyKey, parseInt(btn.dataset.delta, 10))
      );
    });
    container.querySelectorAll('.cart-remove-btn').forEach((btn) => {
      btn.addEventListener('click', () => removeFromCart(btn.dataset.removeKey));
    });
  }

  $('summary-subtotal').textContent = formatCLP(productsSubtotal);
  $('summary-shipping').textContent =
    totalShipping === 0 && totalItems > 0 ? 'GRATIS' : formatCLP(totalShipping);
  $('summary-fee').textContent = formatCLP(upFee);
  $('summary-total').textContent = formatCLP(grandTotal);

  const savings = cartSavings({
    lines: storeGroups.flatMap((group) => group.items),
    products: state.products,
    stores: STORES,
  });
  $('cart-savings').innerHTML = storeGroups.length
    ? `<p><strong>${esc(savings.label)}</strong></p>
       <small>Estimación referencial: no es un precio Verificado ni el «mejor precio».</small>`
    : '';

  const savedCarts = loadState().savedCarts || [];
  $('saved-carts-count').textContent = savedCarts.length;
  $('saved-carts-list').innerHTML = savedCarts.length
    ? `<ul class="up-saved-carts-list">${savedCarts
        .map(
          (saved) => `<li>
            <span>
              <b>${esc(saved.name)}</b>
              <small>${saved.items.length} producto${saved.items.length === 1 ? '' : 's'} · ${esc(
                new Date(saved.savedAt).toLocaleDateString('es-CL')
              )}</small>
            </span>
            <button type="button" class="up-link-btn" data-saved-load="${esc(saved.id)}">Cargar</button>
            <button type="button" class="up-link-btn" data-saved-remove="${esc(saved.id)}">Borrar</button>
          </li>`
        )
        .join('')}</ul>`
    : '<p class="up-text-muted">Aún no guardas carritos. El botón «Guardar para después» los conserva en este navegador.</p>';

  const undoButton = $('cart-undo');
  undoButton.hidden = !getUndoState();
  $('cart-save').disabled = !storeGroups.length;
  $('cart-clear').disabled = !storeGroups.length;

  // Si el carrito deja de tener despacho gratis, el filtro se apaga solo.
  if (syncFreeShippingFilter()) {
    updateFreeShippingButton();
    renderProducts();
  }
}

export function openCartDrawer() {
  openDialog($('cart-drawer-backdrop'), 'close-cart-btn');
}

export function closeCartDrawer() {
  closeDialog($('cart-drawer-backdrop'));
}

export function closeCheckoutModal() {
  closeDialog($('checkout-modal'));
}
