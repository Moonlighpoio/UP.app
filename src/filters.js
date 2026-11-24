/**
 * UP · Filtros y orden avanzado del catálogo.
 * Toda la lógica depende del estado central; la UI solo renderiza el resultado.
 */
import { STORES } from './config.js';
import { state } from './state.js';
import { calculateCartTotals } from './cart.js';
import { getProductStats, unitPriceFor } from './catalog.js';
import { norm } from './utils.js';

export const SORT_OPTIONS = ['default', 'price-asc', 'price-desc', 'savings-desc', 'unit-asc'];

/** Cadenas donde el carrito actual ya alcanzó el umbral de despacho gratis. */
export function freeShippingChainIds() {
  return calculateCartTotals()
    .storeGroups.filter((group) => group.isFreeShipping)
    .map((group) => group.store.id);
}

/** Precio que debe mostrar la tarjeta: el de la cadena elegida o el mejor. */
export function priceForDisplay(product) {
  const stats = getProductStats(product);
  const chain = state.selectedChain;
  if (chain !== 'TODOS' && product.prices[chain] != null) {
    return { price: product.prices[chain], store: STORES[chain], best: false };
  }
  return { price: stats.minPrice, store: stats.bestStore, best: true };
}

export function matchesFilters(product) {
  if (state.selectedCategory !== 'TODOS' && product.category !== state.selectedCategory)
    return false;

  const query = norm(state.searchQuery.trim());
  if (query) {
    const haystack = norm(
      `${product.name} ${product.category} ${product.unit} ${product.description}`
    );
    if (!query.split(/\s+/).every((token) => haystack.includes(token))) return false;
  }

  if (state.selectedChain !== 'TODOS' && product.prices[state.selectedChain] == null) return false;

  if (state.freeShippingOnly) {
    const unlocked = freeShippingChainIds();
    const chains =
      state.selectedChain === 'TODOS' ? Object.keys(product.prices) : [state.selectedChain];
    if (!chains.some((chainId) => unlocked.includes(chainId))) return false;
  }

  return true;
}

export function sortProducts(products) {
  const sorted = products.slice();
  if (state.sortBy === 'price-asc') {
    sorted.sort((a, b) => priceForDisplay(a).price - priceForDisplay(b).price);
  } else if (state.sortBy === 'price-desc') {
    sorted.sort((a, b) => priceForDisplay(b).price - priceForDisplay(a).price);
  } else if (state.sortBy === 'savings-desc') {
    sorted.sort((a, b) => getProductStats(b).maxSavings - getProductStats(a).maxSavings);
  } else if (state.sortBy === 'unit-asc') {
    sorted.sort((a, b) => {
      const left = unitPriceFor(a, priceForDisplay(a).price);
      const right = unitPriceFor(b, priceForDisplay(b).price);
      if (!left) return 1;
      if (!right) return -1;
      return left.value - right.value;
    });
  }
  return sorted;
}

export function resetAdvancedFilters() {
  state.selectedChain = 'TODOS';
  state.freeShippingOnly = false;
  state.sortBy = 'default';
}

/** Si el carrito deja de tener despacho gratis, el filtro se apaga solo. */
export function syncFreeShippingFilter() {
  if (state.freeShippingOnly && freeShippingChainIds().length === 0) {
    state.freeShippingOnly = false;
    return true;
  }
  return false;
}
