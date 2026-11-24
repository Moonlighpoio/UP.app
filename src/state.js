/**
 * UP · Estado central.
 * Un único módulo posee el catálogo, los filtros, el carrito y la verificación
 * de enlaces. El resto de módulos solo accede mediante estas funciones.
 */

export const state = {
  products: [],
  categories: ['TODOS'],
  selectedCategory: 'TODOS',
  searchQuery: '',
  sortBy: 'default',
  activeProductId: null,
  cart: [],
  linkVerification: new Map(),
  reindexQueue: new Set()
};

export function categoriesFrom(products) {
  return ['TODOS', ...Array.from(new Set(products.map((p) => p.category))).sort((a, b) => a.localeCompare(b, 'es'))];
}

export function setCatalog(products, categories) {
  state.products = products;
  state.categories = categories;
}

export function setActiveProduct(id) {
  state.activeProductId = id;
}

export function getProduct(id) {
  return state.products.find((p) => p.id === id);
}

export function setLinkVerification(url, value) {
  state.linkVerification.set(url, value);
}

export function getLinkVerification(url) {
  return state.linkVerification.get(url);
}

export function addReindex(key) {
  state.reindexQueue.add(key);
}

export function hasReindex(key) {
  return state.reindexQueue.has(key);
}

export function clearCart() {
  state.cart = [];
}
