/**
 * UP · Favoritos de producto (FASE U4). Funciones puras sobre up_state_v2.
 * Sólo se pueden marcar productos que existen en el catálogo cargado.
 */

export function isFavorite(state, productId) {
  return Array.isArray(state?.favorites) && state.favorites.includes(productId);
}

/** Devuelve true si quedó marcado, false si se desmarcó, null si es inválido. */
export function toggleFavorite(state, productId, products = []) {
  const id = String(productId || '');
  if (!id || !products.some((product) => product.id === id)) return null;
  const current = Array.isArray(state.favorites) ? state.favorites : [];
  const wasFavorite = current.includes(id);
  state.favorites = wasFavorite
    ? current.filter((item) => item !== id)
    : [...current, id].slice(-300);
  return !wasFavorite;
}

export function favoriteProducts(state, products = []) {
  const ids = Array.isArray(state?.favorites) ? state.favorites : [];
  return products.filter((product) => ids.includes(product.id));
}
