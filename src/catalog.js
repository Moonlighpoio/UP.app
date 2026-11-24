/**
 * UP · Normalización y estadísticas del catálogo.
 */
import { CHAIN_IDS, STORES } from './config.js';
import { categoriesFrom, setCatalog } from './state.js';
import { norm } from './utils.js';

export function iconFor(category) {
  const c = norm(category);
  if (c.includes('bebida')) return 'bottle';
  if (c.includes('lacteo') || c.includes('huevo')) return 'milk';
  if (c.includes('carne')) return 'can';
  if (c.includes('fruta') || c.includes('verdura')) return 'bag';
  if (c.includes('aseo') || c.includes('limpieza')) return 'detergent';
  if (c.includes('personal') || c.includes('mascota')) return 'jar';
  if (c.includes('congelado')) return 'cheese';
  return 'bag';
}

export function mapDemoData(data) {
  return data.products.map((p, i) => ({
    id: p.id,
    index: String(i + 1).padStart(2, '0'),
    name: p.name,
    searchQuery: p.name,
    category: p.category,
    unit: p.detail,
    description: p.description || '',
    image: p.image || null,
    icon: iconFor(p.category),
    skus: p.skus || {},
    source: p.source || null,
    prices: Object.fromEntries(CHAIN_IDS.filter((c) => p.prices[c] != null).map((c) => [c, p.prices[c]]))
  }));
}

export function applyDemoData(data) {
  const products = mapDemoData(data);
  setCatalog(products, categoriesFrom(products));
  return products;
}

export function getProductStats(product) {
  const entries = Object.entries(product.prices)
    .filter(([storeId]) => STORES[storeId])
    .map(([storeId, price]) => ({ storeId, price, store: STORES[storeId] }))
    .sort((a, b) => a.price - b.price);
  if (!entries.length) return { sorted: [], minPrice: 0, maxPrice: 0, maxSavings: 0, bestStore: null };
  return {
    sorted: entries,
    minPrice: entries[0].price,
    maxPrice: entries[entries.length - 1].price,
    maxSavings: entries[entries.length - 1].price - entries[0].price,
    bestStore: entries[0].store
  };
}
