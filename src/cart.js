/**
 * UP · Carrito multi-supermercado y matemática de dinero.
 * El fee del 1% se retiene del subtotal de cada cadena: NO se agrega al cobro.
 */
import { STORES } from './config.js';
import { state, getProduct } from './state.js';
import { calculateMoney } from './money.js';

const hooks = {
  notify: () => {},
  render: () => {}
};

export function initCart(nextHooks = {}) {
  hooks.notify = nextHooks.notify || hooks.notify;
  hooks.render = nextHooks.render || hooks.render;
}

export function calculateCartTotals() {
  // Resolución de datos (productos + cadenas) y delegación a la lógica pura.
  const lines = [];
  state.cart.forEach((item) => {
    const product = getProduct(item.productId);
    const store = STORES[item.storeId];
    if (!product || !store || product.prices[item.storeId] == null) return;
    lines.push({ ...item, unitPrice: product.prices[item.storeId], product });
  });
  return calculateMoney({ lines, stores: STORES });
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
