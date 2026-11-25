/**
 * UP · Normalización y estadísticas del catálogo.
 */
import { CHAIN_IDS, STORES } from './config.js';
import { categoriesFrom, setCatalog } from './state.js';
import { norm } from './utils.js';
import { isVerifiedFresh } from './freshness.js';
import { overrideKey } from './reports.js';

const UNIT_CANON = {
  kg: 'kg',
  g: 'g',
  l: 'L',
  lt: 'L',
  ml: 'ml',
  m: 'm',
  un: 'un',
  unidad: 'un',
  unidades: 'un',
  rollo: 'un',
  rollos: 'un',
};
// Preferimos la unidad más pequeña y comparable (kg antes que g, L antes que ml, etc.).
const UNIT_RANK = { kg: 0, g: 1, L: 2, ml: 3, m: 4, un: 5 };
const UNIT_DISPLAY = {
  kg: { divisor: 1, label: '/kg' },
  g: { divisor: 0.01, label: '/100 g' },
  L: { divisor: 1, label: '/L' },
  ml: { divisor: 0.01, label: '/100 ml' },
  m: { divisor: 1, label: '/m' },
  un: { divisor: 1, label: '/un' },
};

/**
 * Extrae cantidad y unidad de textos como "Bidón 6,5 L" o "Bolsa 500 g".
 * Heurística documentada: se toma la primera coincidencia de la unidad con
 * mayor prioridad; si no hay unidad reconocida, devuelve null.
 */
export function unitInfo(detail) {
  const text = norm(detail || '').replace(',', '.');
  const matches = [
    ...text.matchAll(/(\d+(?:\.\d+)?)\s*(kg|lt|l|ml|g|m|rollos|rollo|unidades|unidad|un)\b/g),
  ];
  if (!matches.length) return null;

  const best = matches.reduce((acc, match) => {
    const unit = UNIT_CANON[match[2]];
    const rank = UNIT_RANK[unit];
    if (!acc || rank < acc.rank || (rank === acc.rank && match.index < acc.index)) {
      return { quantity: Number(match[1]), unit, rank, index: match.index };
    }
    return acc;
  }, null);
  const display = UNIT_DISPLAY[best.unit];
  return {
    quantity: best.quantity,
    unit: best.unit,
    divisor: display.divisor,
    label: display.label,
  };
}

export function unitPriceFor(product, price) {
  if (!price || !Number.isFinite(price)) return null;
  const info = product.unitPricing || unitInfo(product.unit);
  if (!info || !info.quantity) return null;
  return {
    value: price / (info.quantity * info.divisor),
    label: info.label,
    quantity: info.quantity,
    unit: info.unit,
  };
}

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
    unitPricing: unitInfo(p.detail),
    description: p.description || '',
    descriptionSource: p.descriptionSource || 'UP · texto propio (demo)',
    image: p.image || null,
    icon: iconFor(p.category),
    skus: p.skus || {},
    promos: p.promos || {},
    source: p.source || null,
    prices: Object.fromEntries(
      CHAIN_IDS.filter((c) => p.prices[c] != null).map((c) => [c, p.prices[c]])
    ),
  }));
}

export function applyDemoData(data) {
  const products = mapDemoData(data);
  setCatalog(products, categoriesFrom(products));
  return products;
}

function skuFor(product, storeId, overrides) {
  const sku = { ...(product.skus?.[storeId] || {}) };
  if (overrides?.[overrideKey(product.id, storeId)]?.status === 'pending') sku.status = 'pending';
  return sku;
}

/** SKU efectivo: aplica los cambios locales de moderación sin mutar el catálogo. */
export function effectiveSku(product, storeId, overrides) {
  return skuFor(product, storeId, overrides);
}

/** Sólo ofertas verificadas y frescas pueden reclamar "mejor precio" (U1). */
export function getConfirmedProductStats(product, options = {}) {
  const entries = Object.entries(product.prices || {})
    .filter(([storeId, price]) => STORES[storeId] && Number.isFinite(price) && price > 0)
    .filter(([storeId]) => isVerifiedFresh(skuFor(product, storeId, options.overrides), options))
    .map(([storeId, price]) => ({
      storeId,
      price,
      store: STORES[storeId],
      sku: skuFor(product, storeId, options.overrides),
    }))
    .sort((a, b) => a.price - b.price);
  if (!entries.length) {
    return { sorted: [], minPrice: null, maxPrice: null, maxSavings: 0, bestStore: null };
  }
  return {
    sorted: entries,
    minPrice: entries[0].price,
    maxPrice: entries[entries.length - 1].price,
    maxSavings: entries[entries.length - 1].price - entries[0].price,
    bestStore: entries[0].store,
  };
}

export function hasVerifiedFreshPrice(product, options = {}) {
  return Object.keys(product.prices || {}).some(
    (storeId) =>
      STORES[storeId] && isVerifiedFresh(skuFor(product, storeId, options.overrides), options)
  );
}

export function getProductStats(product) {
  const entries = Object.entries(product.prices)
    .filter(([storeId]) => STORES[storeId])
    .map(([storeId, price]) => ({ storeId, price, store: STORES[storeId] }))
    .sort((a, b) => a.price - b.price);
  if (!entries.length)
    return { sorted: [], minPrice: 0, maxPrice: 0, maxSavings: 0, bestStore: null };
  return {
    sorted: entries,
    minPrice: entries[0].price,
    maxPrice: entries[entries.length - 1].price,
    maxSavings: entries[entries.length - 1].price - entries[0].price,
    bestStore: entries[0].store,
  };
}
