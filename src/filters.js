/**
 * UP · Filtros y orden avanzado del catálogo.
 * Toda la lógica depende del estado central; la UI solo renderiza el resultado.
 */
import { STORES } from './config.js';
import { state } from './state.js';
import { calculateCartTotals } from './cart.js';
import { getProductStats, unitPriceFor } from './catalog.js';
import { formatCLP, norm, safeHttpUrl } from './utils.js';

export const SORT_OPTIONS = ['default', 'price-asc', 'price-desc', 'savings-desc', 'unit-asc'];

export const DELIVERY_OPTIONS = [
  { value: 0, label: 'Cualquier plazo' },
  { value: 24, label: 'Despacho en 24 h' },
  { value: 48, label: 'Hasta 48 h' },
];

export const AVAILABILITY_OPTIONS = [
  { value: 'TODOS', label: 'Todos' },
  { value: 'CONFIRMADO', label: 'Precio confirmado' },
  { value: 'REFERENCIAL', label: 'Solo referencia' },
];

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

function pricedChainIds(product) {
  return Object.keys(product.prices || {}).filter(
    (id) => STORES[id] && Number.isFinite(product.prices[id])
  );
}

function relevantChainIds(product) {
  return state.selectedChain === 'TODOS'
    ? pricedChainIds(product)
    : pricedChainIds(product).filter((id) => id === state.selectedChain);
}

/** El producto tiene promoción en la cadena elegida (o en cualquier cadena). */
export function hasOffer(product) {
  const promos = product.promos || {};
  return relevantChainIds(product).some((id) => Boolean(promos[id]));
}

/** "Confirmado" significa que existe una URL canónica de ficha para un precio vigente. */
export function hasConfirmedPrice(product) {
  return relevantChainIds(product).some((id) => safeHttpUrl(product.skus?.[id]?.url));
}

/** Plazo demo más rápido entre las cadenas con precio para este producto. */
export function deliveryHoursFor(product) {
  const hours = relevantChainIds(product)
    .map((id) => STORES[id].deliveryHours)
    .filter(Number.isFinite);
  return hours.length ? Math.min(...hours) : Infinity;
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

  const shown = priceForDisplay(product);
  if (!Number.isFinite(shown.price) || shown.price <= 0) return false;
  if (shown.price < state.minPrice) return false;
  if (Number.isFinite(state.maxPrice) && shown.price > state.maxPrice) return false;

  if (state.offersOnly && !hasOffer(product)) return false;
  if (state.maxDelivery > 0 && deliveryHoursFor(product) > state.maxDelivery) return false;

  const confirmed = hasConfirmedPrice(product);
  if (state.availability === 'CONFIRMADO' && !confirmed) return false;
  if (state.availability === 'REFERENCIAL' && confirmed) return false;

  if (state.freeShippingOnly) {
    const unlocked = freeShippingChainIds();
    if (!relevantChainIds(product).some((chainId) => unlocked.includes(chainId))) return false;
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

/** Límites redondeados a centena para los campos de precio. */
export function priceBounds() {
  const prices = state.products
    .map((product) => priceForDisplay(product).price)
    .filter((price) => Number.isFinite(price) && price > 0);
  if (!prices.length) return { min: 0, max: 100000 };
  return {
    min: Math.floor(Math.min(...prices) / 100) * 100,
    max: Math.ceil(Math.max(...prices) / 100) * 100,
  };
}

/**
 * Contadores contextuales: cada opción se cuenta con el resto de filtros activos.
 * Permite mostrar "Cadena · Jumbo (8)" sin recalcular en cada render de tarjeta.
 */
export function facetCounts() {
  const snapshot = { ...state };
  const count = (overrides) => {
    Object.assign(state, overrides);
    const total = state.products.filter(matchesFilters).length;
    Object.assign(state, snapshot);
    return total;
  };

  return {
    all: count({}),
    chain: Object.fromEntries(
      ['TODOS', ...Object.keys(STORES)].map((id) => [id, count({ selectedChain: id })])
    ),
    offers: count({ offersOnly: true }),
    shipping: count({ freeShippingOnly: true }),
    delivery: Object.fromEntries(
      DELIVERY_OPTIONS.map((option) => [String(option.value), count({ maxDelivery: option.value })])
    ),
    availability: Object.fromEntries(
      AVAILABILITY_OPTIONS.map((option) => [option.value, count({ availability: option.value })])
    ),
  };
}

export function activeFilterChips() {
  const chips = [];
  if (state.selectedCategory !== 'TODOS') {
    chips.push({ key: 'category', label: `Categoría: ${state.selectedCategory}` });
  }
  if (state.selectedChain !== 'TODOS') {
    chips.push({ key: 'chain', label: `Cadena: ${STORES[state.selectedChain]?.name || '—'}` });
  }
  if (state.minPrice > 0 || Number.isFinite(state.maxPrice)) {
    const from = formatCLP(state.minPrice);
    const to = Number.isFinite(state.maxPrice) ? formatCLP(state.maxPrice) : 'sin límite';
    chips.push({ key: 'price', label: `Precio: ${from} – ${to}` });
  }
  if (state.offersOnly) chips.push({ key: 'offers', label: 'Solo ofertas' });
  if (state.freeShippingOnly) chips.push({ key: 'shipping', label: 'Despacho gratis' });
  if (state.maxDelivery > 0) {
    chips.push({
      key: 'delivery',
      label: `Plazo: ${DELIVERY_OPTIONS.find((o) => o.value === state.maxDelivery)?.label || ''}`,
    });
  }
  if (state.availability !== 'TODOS') {
    chips.push({
      key: 'availability',
      label: `Disponibilidad: ${
        AVAILABILITY_OPTIONS.find((o) => o.value === state.availability)?.label || ''
      }`,
    });
  }
  if (state.searchQuery.trim())
    chips.push({ key: 'search', label: `Búsqueda: ${state.searchQuery}` });
  return chips;
}

export function resetAdvancedFilters() {
  state.selectedChain = 'TODOS';
  state.freeShippingOnly = false;
  state.sortBy = 'default';
  state.minPrice = 0;
  state.maxPrice = Infinity;
  state.offersOnly = false;
  state.maxDelivery = 0;
  state.availability = 'TODOS';
}

export function resetAllFilters() {
  state.selectedCategory = 'TODOS';
  state.searchQuery = '';
  resetAdvancedFilters();
}

export function clearFilter(key) {
  if (key === 'all') return resetAllFilters();
  if (key === 'category') state.selectedCategory = 'TODOS';
  else if (key === 'search') state.searchQuery = '';
  else if (key === 'chain') state.selectedChain = 'TODOS';
  else if (key === 'price') {
    state.minPrice = 0;
    state.maxPrice = Infinity;
  } else if (key === 'offers') state.offersOnly = false;
  else if (key === 'shipping') state.freeShippingOnly = false;
  else if (key === 'delivery') state.maxDelivery = 0;
  else if (key === 'availability') state.availability = 'TODOS';
  else if (key === 'sort') state.sortBy = 'default';
}

/** Si el carrito deja tener despacho gratis, el filtro se apaga solo. */
export function syncFreeShippingFilter() {
  if (state.freeShippingOnly && freeShippingChainIds().length === 0) {
    state.freeShippingOnly = false;
    return true;
  }
  return false;
}

function readBool(value) {
  return value === '1' || value === 'true';
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** Parámetros soportados: cat, chain, sort, q, min, max, offers, shipping, delivery, availability. */
export function readUrlFilters(
  search = typeof window !== 'undefined' ? window.location.search : ''
) {
  const raw = search ? String(search) : '';
  const query = raw.includes('?')
    ? raw.slice(raw.indexOf('?')).split('#')[0]
    : `?${raw.split('#')[0]}`;
  const params = new URLSearchParams(query);
  const bounds = priceBounds();
  const values = {};

  if (params.has('cat') && state.categories.includes(params.get('cat'))) {
    values.selectedCategory = params.get('cat');
  }
  if (params.has('chain')) {
    const chain = params.get('chain');
    values.selectedChain = chain === 'TODOS' || STORES[chain] ? chain : 'TODOS';
  }
  if (params.has('sort') && SORT_OPTIONS.includes(params.get('sort'))) {
    values.sortBy = params.get('sort');
  }
  if (params.has('q')) values.searchQuery = params.get('q').slice(0, 120);
  if (params.has('min')) {
    const min = Number(params.get('min'));
    values.minPrice = Number.isFinite(min) ? clamp(min, 0, bounds.max) : 0;
  }
  if (params.has('max')) {
    const max = Number(params.get('max'));
    values.maxPrice =
      Number.isFinite(max) && max < bounds.max ? clamp(max, 0, bounds.max) : Infinity;
  }
  if (params.has('offers')) values.offersOnly = readBool(params.get('offers'));
  if (params.has('shipping')) values.freeShippingOnly = readBool(params.get('shipping'));
  if (params.has('delivery')) {
    const delivery = Number(params.get('delivery'));
    values.maxDelivery = DELIVERY_OPTIONS.some((option) => option.value === delivery)
      ? delivery
      : 0;
  }
  if (params.has('availability')) {
    const availability = params.get('availability');
    values.availability = AVAILABILITY_OPTIONS.some((option) => option.value === availability)
      ? availability
      : 'TODOS';
  }
  if (Number.isFinite(values.maxPrice) && Number.isFinite(values.minPrice)) {
    values.minPrice = Math.min(values.minPrice, values.maxPrice);
    values.maxPrice = Math.max(values.minPrice, values.maxPrice);
  }
  return values;
}

export function applyUrlFilters(search) {
  resetAllFilters();
  Object.assign(state, readUrlFilters(search));
}

export function syncUrlFilters() {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const params = new URLSearchParams();
  const put = (key, value) => params.set(key, String(value));

  if (state.selectedCategory !== 'TODOS') put('cat', state.selectedCategory);
  if (state.selectedChain !== 'TODOS') put('chain', state.selectedChain);
  if (state.sortBy !== 'default') put('sort', state.sortBy);
  if (state.searchQuery.trim()) put('q', state.searchQuery.trim());
  if (state.minPrice > 0) put('min', state.minPrice);
  if (Number.isFinite(state.maxPrice)) put('max', state.maxPrice);
  if (state.offersOnly) put('offers', 1);
  if (state.freeShippingOnly) put('shipping', 1);
  if (state.maxDelivery > 0) put('delivery', state.maxDelivery);
  if (state.availability !== 'TODOS') put('availability', state.availability);

  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  try {
    window.history.replaceState(window.history.state, '', url);
  } catch {
    // file: no permite replaceState; el modo estático sigue funcionando igual.
  }
}
