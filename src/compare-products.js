/**
 * UP · Comparación de hasta 3 productos (FASE U4). Lógica pura y testeable.
 * Reutiliza las estadísticas y el precio por unidad del catálogo existente.
 */
import { STORES } from './config.js';
import { getProductStats, unitPriceFor } from './catalog.js';
import { overrideKey } from './reports.js';

export const MAX_COMPARE_PRODUCTS = 3;

function cleanIds(ids) {
  return Array.isArray(ids)
    ? [...new Set(ids.filter((id) => typeof id === 'string' && id))].slice(0, MAX_COMPARE_PRODUCTS)
    : [];
}

export function addToComparison(ids, productId) {
  const current = cleanIds(ids);
  const id = String(productId || '');
  if (!id) return { ids: current, added: false, reason: 'id' };
  if (current.includes(id)) return { ids: current, added: false, reason: 'ya' };
  if (current.length >= MAX_COMPARE_PRODUCTS) {
    return { ids: current, added: false, reason: 'limite' };
  }
  return { ids: [...current, id], added: true, reason: '' };
}

export function removeFromComparison(ids, productId) {
  return cleanIds(ids).filter((id) => id !== productId);
}

export function toggleComparison(ids, productId) {
  const current = cleanIds(ids);
  return current.includes(productId)
    ? { ids: removeFromComparison(current, productId), added: false, reason: 'quitado' }
    : addToComparison(current, productId);
}

/** Matriz producto × cadena con precio, $/unidad, formato y procedencia. */
export function comparisonMatrix(products = [], options = {}) {
  const chains = options.chains || Object.keys(STORES);
  const overrides = options.overrides || {};
  return products.filter(Boolean).map((product) => {
    const stats = getProductStats(product);
    return {
      id: product.id,
      name: product.name,
      category: product.category,
      format: product.unit,
      image: product.image || null,
      icon: product.icon || null,
      unit: unitPriceFor(product, stats.minPrice),
      minPrice: stats.minPrice,
      chains: chains.map((chainId) => {
        const store = STORES[chainId];
        const price = product.prices?.[chainId];
        const unit = unitPriceFor(product, price);
        const status =
          overrides[overrideKey(product.id, chainId)]?.status ||
          product.skus?.[chainId]?.status ||
          'pending';
        return {
          chainId,
          storeName: store?.name || chainId,
          price: Number.isFinite(price) && price > 0 ? price : null,
          unitPrice: unit?.value ?? null,
          unitLabel: unit?.label ?? null,
          status,
          confirmed: status === 'verified',
        };
      }),
    };
  });
}
