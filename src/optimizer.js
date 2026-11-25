/**
 * UP · Optimizador "¿Dónde me conviene comprar?" (FASE U3).
 * Funciones puras. Sólo entran ofertas `verified` y frescas; el despacho y el
 * envío gratis se calculan con la misma matemática del carrito. El fee del 1%
 * se explica, pero no se suma al total del cliente.
 */
import { STALE_MS, STORES } from './config.js';
import { capturedAtOf, isVerifiedFresh } from './freshness.js';
import { calculateMoney, formatCLP } from './money.js';
import { overrideKey } from './reports.js';
import { norm } from './utils.js';

function effectiveSku(product, chainId, overrides) {
  const sku = { ...(product?.skus?.[chainId] || {}) };
  if (overrides?.[overrideKey(product.id, chainId)]?.status === 'pending') sku.status = 'pending';
  return sku;
}

/** Ofertas confirmadas por producto, ordenadas de menor a mayor precio. */
export function confirmedOffersFor(product, options = {}) {
  if (!product) return [];
  const { stores = STORES, overrides = {}, now = Date.now(), staleMs = STALE_MS } = options;
  return Object.entries(product.prices || {})
    .filter(([chainId, price]) => stores[chainId] && Number.isFinite(price) && price > 0)
    .map(([chainId, price]) => {
      const sku = effectiveSku(product, chainId, overrides);
      if (!isVerifiedFresh(sku, { now, staleMs })) return null;
      return {
        chainId,
        price,
        sku,
        capturedAt: capturedAtOf(sku),
        store: stores[chainId],
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.price - b.price || a.chainId.localeCompare(b.chainId));
}

function buildScenario(input) {
  const { id, title, description, chainIds, items, offersByItem, products, stores, storeHint } =
    input;
  const assignments = {};
  const missing = [];
  const lines = [];

  items.forEach((item) => {
    const product = products.find((entry) => entry.id === item.productId);
    const choice = (offersByItem[item.productId] || [])
      .filter((offer) => chainIds.includes(offer.chainId))
      .sort((a, b) => a.price - b.price)[0];
    if (!choice) {
      missing.push({
        productId: item.productId,
        name: product?.name || item.productId,
        qty: item.qty,
        reason: (offersByItem[item.productId] || []).length
          ? 'Sin precio confirmado en estas cadenas'
          : 'Sin precio verificado y fresco',
      });
      return;
    }
    assignments[item.productId] = {
      chainId: choice.chainId,
      storeId: choice.chainId,
      price: choice.price,
      capturedAt: choice.capturedAt,
      qty: item.qty,
    };
    lines.push({
      productId: item.productId,
      storeId: choice.chainId,
      unitPrice: choice.price,
      qty: item.qty,
    });
  });

  const money = calculateMoney({ lines, stores });
  return {
    id,
    title,
    description,
    chainIds,
    storeHint: storeHint || null,
    assignments,
    missing,
    lines,
    covered: items.length - missing.length,
    total: money.grandTotal,
    productsSubtotal: money.productsSubtotal,
    shipping: money.totalShipping,
    upFee: money.upFee,
    storeGroups: money.storeGroups,
  };
}

function withSavings(scenario, reference) {
  const difference = (reference?.total || 0) - scenario.total;
  const pct = reference?.total ? Math.round((difference / reference.total) * 1000) / 10 : 0;
  return {
    ...scenario,
    savings: difference,
    savingsPct: pct,
    savingsLabel:
      difference > 0
        ? `Ahorras ${formatCLP(difference)} (${pct}%)`
        : difference < 0
          ? `Cuesta ${formatCLP(Math.abs(difference))} (${Math.abs(pct)}%) más`
          : 'Sin diferencia de precio',
  };
}

function rank(a, b) {
  if (a.missing.length !== b.missing.length) return a.missing.length - b.missing.length;
  if (a.total !== b.total) return a.total - b.total;
  return a.id.localeCompare(b.id);
}

function pairs(chains) {
  const out = [];
  for (let i = 0; i < chains.length; i += 1) {
    for (let j = i + 1; j < chains.length; j += 1) out.push([chains[i], chains[j]]);
  }
  return out;
}

/**
 * @param {object} input
 * @param {Array<{productId:string,qty:number}>} input.items
 * @param {Array<object>} input.products catálogo ya normalizado
 * @param {string} [input.commune] comuna elegida por el usuario
 * @param {Array<object>} [input.storesData] sucursales de ejemplo con comuna y distanceKm
 */
export function optimizeList(input = {}) {
  const {
    items = [],
    products = [],
    stores = STORES,
    storesData = [],
    commune = '',
    overrides = {},
    now = Date.now(),
    staleMs = STALE_MS,
  } = input;

  const offersByItem = {};
  items.forEach((item) => {
    const product = products.find((entry) => entry.id === item.productId);
    offersByItem[item.productId] = confirmedOffersFor(product, {
      stores,
      overrides,
      now,
      staleMs,
    });
  });

  const chains = Object.keys(stores).filter((chainId) =>
    Object.values(offersByItem).some((offers) => offers.some((o) => o.chainId === chainId))
  );

  if (!items.length || !chains.length) {
    return {
      items,
      offersByItem,
      scenarios: [],
      reference: null,
      message: items.length ? 'No hay ofertas verificadas y frescas para esta lista.' : '',
    };
  }

  const singles = chains.map((chainId) =>
    buildScenario({
      id: `single-${chainId}`,
      title: `Sólo ${stores[chainId].name}`,
      description: 'Una sola cadena, un solo despacho.',
      chainIds: [chainId],
      items,
      offersByItem,
      products,
      stores,
    })
  );
  const complete = singles.filter((scenario) => !scenario.missing.length);
  const reference = [...(complete.length ? complete : singles)].sort(
    (a, b) => b.total - a.total
  )[0];

  const bestSingle = [...singles].sort(rank)[0];
  const splits = pairs(chains).map((chainIds) =>
    buildScenario({
      id: `split-${chainIds.join('-')}`,
      title: `${chainIds.map((id) => stores[id].short).join(' + ')}`,
      description: 'Reparto óptimo entre dos cadenas.',
      chainIds,
      items,
      offersByItem,
      products,
      stores,
    })
  );
  const bestSplit = splits.length ? [...splits].sort(rank)[0] : null;

  const target = norm(commune);
  const nearby = storesData.filter(
    (store) =>
      norm(store.comuna) === target && stores[store.chain] && Number.isFinite(store.distanceKm)
  );
  const distanceByChain = new Map();
  nearby.forEach((store) => {
    const current = distanceByChain.get(store.chain);
    if (!current || store.distanceKm < current.distanceKm) {
      distanceByChain.set(store.chain, store);
    }
  });
  let nearest = null;
  if (nearby.length) {
    const candidates = singles
      .filter((scenario) => distanceByChain.has(scenario.chainIds[0]))
      .map((scenario) => {
        const store = distanceByChain.get(scenario.chainIds[0]);
        return { ...scenario, storeHint: { ...store, isDemo: true } };
      })
      .sort(
        (a, b) =>
          a.missing.length - b.missing.length ||
          a.storeHint.distanceKm - b.storeHint.distanceKm ||
          a.total - b.total
      );
    nearest = candidates[0] || null;
  }

  const scenarios = [withSavings(bestSingle, reference)];
  const splitIsBetter =
    bestSplit && bestSplit.id !== bestSingle.id && rank(bestSplit, bestSingle) < 0;
  if (splitIsBetter) {
    scenarios.push(withSavings(bestSplit, reference));
  } else {
    scenarios.push({
      id: 'split-none',
      title: 'Reparto entre 2 cadenas',
      description: 'No hay una combinación de dos cadenas que mejore la cadena única.',
      available: false,
      chainIds: [],
      assignments: {},
      missing: [],
      covered: 0,
      total: null,
      productsSubtotal: 0,
      shipping: 0,
      upFee: 0,
      storeGroups: [],
      savings: 0,
      savingsPct: 0,
      savingsLabel: 'Sin combinación mejor',
    });
  }
  scenarios.push(
    nearest
      ? {
          ...withSavings(nearest, reference),
          id: 'nearest',
          title: `Más cercana · ${nearest.storeHint.name}`,
          description: `Sucursal de ejemplo a ${nearest.storeHint.distanceKm} km de ${commune}.`,
          available: true,
        }
      : {
          id: 'nearest',
          title: 'Cadena más cercana',
          description: commune
            ? `No hay sucursales de ejemplo en ${commune}.`
            : 'Agrega una comuna para ver este escenario.',
          available: false,
          chainIds: [],
          assignments: {},
          missing: [],
          covered: 0,
          total: null,
          productsSubtotal: 0,
          shipping: 0,
          upFee: 0,
          storeGroups: [],
          savings: 0,
          savingsPct: 0,
          savingsLabel: 'Sin datos de ubicación',
        }
  );

  return {
    items,
    offersByItem,
    scenarios,
    reference: reference
      ? { id: reference.id, title: reference.title, total: reference.total }
      : null,
    message: '',
  };
}
