/**
 * UP · Carrito multi-supermercado y matemática de dinero.
 * El fee del 1% se retiene del subtotal de cada cadena: NO se agrega al cobro.
 */
import { STORES } from './config.js';
import { state, getProduct } from './state.js';
import { calculateMoney } from './money.js';
import { recordAddToCart } from './analytics-ui.js';

export const UNDO_MS = 5000;

const hooks = {
  notify: () => {},
  notifyUndo: () => {},
  render: () => {},
};

let lastUndo = null;
let undoTimer = null;

export function initCart(nextHooks = {}) {
  hooks.notify = nextHooks.notify || hooks.notify;
  hooks.notifyUndo = nextHooks.notifyUndo || hooks.notifyUndo;
  hooks.render = nextHooks.render || hooks.render;
}

function snapshot() {
  return state.cart.map((item) => ({ ...item }));
}

function registerUndo(label) {
  lastUndo = { items: snapshot(), label, at: Date.now() };
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    lastUndo = null;
    hooks.render();
  }, UNDO_MS);
  if (undoTimer.unref) undoTimer.unref();
  hooks.notifyUndo(label);
}

export function getUndoState() {
  if (!lastUndo || Date.now() - lastUndo.at >= UNDO_MS) return null;
  return { label: lastUndo.label, remainingMs: UNDO_MS - (Date.now() - lastUndo.at) };
}

export function undoLastCartChange() {
  if (!getUndoState()) return false;
  state.cart = lastUndo.items.map((item) => ({ ...item }));
  lastUndo = null;
  clearTimeout(undoTimer);
  hooks.notify('Cambio deshecho');
  hooks.render();
  return true;
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
  recordAddToCart(productId, storeId, qty);
  hooks.notify(`+${qty} ${product.name} (${STORES[storeId].short})`);
  hooks.render();
}

export function updateCartQty(key, delta) {
  const idx = state.cart.findIndex((i) => i.key === key);
  if (idx === -1) return;
  const nextQty = state.cart[idx].qty + delta;
  const removesItem = nextQty <= 0;
  if (!removesItem) {
    state.cart[idx].qty = nextQty;
    hooks.render();
    return;
  }
  registerUndo('Producto eliminado');
  state.cart = state.cart.filter((i) => i.key !== key);
  hooks.render();
}

export function removeFromCart(key) {
  registerUndo('Producto eliminado');
  state.cart = state.cart.filter((i) => i.key !== key);
  hooks.render();
}

export function clearCartItems({ notifyUndo = true } = {}) {
  if (!state.cart.length) return;
  if (notifyUndo) registerUndo('Carrito vaciado');
  state.cart = [];
  hooks.render();
}

/** Carga un carrito guardado sin perder los carritos ya presentes por cadena. */
export function loadSavedCartItems(items = []) {
  const clean = (Array.isArray(items) ? items : [])
    .filter((item) => {
      const product = getProduct(item?.productId);
      return (
        product &&
        STORES[item.storeId] &&
        Number.isFinite(product.prices[item.storeId]) &&
        Number.isInteger(Number(item.qty)) &&
        Number(item.qty) > 0
      );
    })
    .map((item) => ({
      key: `${item.productId}_${item.storeId}`,
      productId: item.productId,
      storeId: item.storeId,
      qty: Math.min(99, Number(item.qty)),
    }));
  if (!clean.length) return 0;

  registerUndo('Carrito guardado cargado');
  const next = state.cart.map((item) => ({ ...item }));
  clean.forEach((item) => {
    const existing = next.find((line) => line.key === item.key);
    if (existing) existing.qty = Math.min(99, existing.qty + item.qty);
    else next.push(item);
  });
  state.cart = next;
  hooks.render();
  return clean.length;
}
