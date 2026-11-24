/**
 * UP · Carrito multi-supermercado y matemática de dinero.
 * El fee del 1% se retiene del subtotal de cada cadena: NO se agrega al cobro.
 */
import { STORES, UP_FEE_RATE } from './config.js';
import { state, getProduct } from './state.js';

const hooks = {
  notify: () => {},
  render: () => {}
};

export function initCart(nextHooks = {}) {
  hooks.notify = nextHooks.notify || hooks.notify;
  hooks.render = nextHooks.render || hooks.render;
}

export function calculateCartTotals() {
  const groups = {};
  let totalItems = 0;
  let productsSubtotal = 0;

  state.cart.forEach((item) => {
    const product = getProduct(item.productId);
    const store = STORES[item.storeId];
    if (!product || !store || product.prices[item.storeId] == null) return;
    const unitPrice = product.prices[item.storeId];
    const lineTotal = unitPrice * item.qty;
    if (!groups[item.storeId]) groups[item.storeId] = { store, items: [], subtotal: 0 };
    groups[item.storeId].items.push({ ...item, product, unitPrice, lineTotal });
    groups[item.storeId].subtotal += lineTotal;
    totalItems += item.qty;
    productsSubtotal += lineTotal;
  });

  const storeGroups = Object.values(groups).map((g) => {
    const missingForFree = Math.max(0, g.store.freeShippingThreshold - g.subtotal);
    const isFreeShipping = missingForFree === 0;
    const shipping = isFreeShipping ? 0 : g.store.shippingCost;
    const progressPct = Math.min(100, Math.round((g.subtotal / g.store.freeShippingThreshold) * 100));
    const fee = Math.round(g.subtotal * UP_FEE_RATE);
    return { ...g, missingForFree, isFreeShipping, shipping, progressPct, fee, payout: g.subtotal - fee };
  });

  const totalShipping = storeGroups.reduce((acc, g) => acc + g.shipping, 0);
  const upFee = storeGroups.reduce((acc, g) => acc + g.fee, 0);
  const payoutTotal = productsSubtotal - upFee;
  // El 1% se retiene del subtotal: NO se suma al cobro del cliente.
  const grandTotal = productsSubtotal + totalShipping;
  return { storeGroups, totalItems, productsSubtotal, totalShipping, upFee, payoutTotal, grandTotal };
}

export function addToCart(productId, storeId, qty = 1) {
  const key = `${productId}_${storeId}`;
  const existing = state.cart.find((item) => item.key === key);
  if (existing) existing.qty += qty;
  else state.cart.push({ key, productId, storeId, qty });
  const product = getProduct(productId);
  hooks.notify(`+${qty} ${product.name} (${STORES[storeId].short})`);
  hooks.render();
}

export function updateCartQty(key, delta) {
  const idx = state.cart.findIndex((i) => i.key === key);
  if (idx === -1) return;
  state.cart[idx].qty += delta;
  if (state.cart[idx].qty <= 0) state.cart.splice(idx, 1);
  hooks.render();
}

export function removeFromCart(key) {
  state.cart = state.cart.filter((i) => i.key !== key);
  hooks.render();
}
