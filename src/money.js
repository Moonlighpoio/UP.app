/**
 * UP · Matemática de dinero pura y testeable.
 * Sin DOM, sin estado global: todas las funciones son deterministas.
 *
 * Regla de negocio:
 *   platformFee   = Σ round(subtotalPorCadena × 0.01)
 *   payout        = subtotal − fee
 *   totalCobrado  = subtotalProductos + despachoTotal
 * El fee NO se agrega al cobro del cliente: se retiene de la liquidación.
 */
import { UP_FEE_RATE } from './config.js';

export function lineTotal(unitPrice, qty) {
  return unitPrice * qty;
}

export function subtotalFor(lines) {
  return lines.reduce((acc, line) => acc + lineTotal(line.unitPrice, line.qty), 0);
}

export function shippingFor(store, subtotal) {
  const missingForFree = Math.max(0, store.freeShippingThreshold - subtotal);
  const isFreeShipping = missingForFree === 0;
  const shipping = isFreeShipping ? 0 : store.shippingCost;
  const progressPct = Math.min(100, Math.round((subtotal / store.freeShippingThreshold) * 100));
  return { missingForFree, isFreeShipping, shipping, progressPct };
}

export function feeFor(subtotal, rate = UP_FEE_RATE) {
  return Math.round(subtotal * rate);
}

export function payoutFor(subtotal, rate = UP_FEE_RATE) {
  return subtotal - feeFor(subtotal, rate);
}

export function grandTotalFor(productsSubtotal, totalShipping) {
  return productsSubtotal + totalShipping;
}

/**
 * @param {object} input
 * @param {Array<{storeId:string, unitPrice:number, qty:number}>} input.lines
 * @param {Record<string, {freeShippingThreshold:number, shippingCost:number}>} input.stores
 * @param {number} [input.feeRate]
 */
export function calculateMoney({ lines, stores, feeRate = UP_FEE_RATE }) {
  const groups = {};
  let totalItems = 0;
  let productsSubtotal = 0;

  lines.forEach((line) => {
    const store = stores[line.storeId];
    if (!store) return;
    const total = lineTotal(line.unitPrice, line.qty);
    if (!groups[line.storeId]) groups[line.storeId] = { store, items: [], subtotal: 0 };
    groups[line.storeId].items.push({ ...line, lineTotal: total });
    groups[line.storeId].subtotal += total;
    totalItems += line.qty;
    productsSubtotal += total;
  });

  const storeGroups = Object.values(groups).map((g) => {
    const shipping = shippingFor(g.store, g.subtotal);
    const fee = feeFor(g.subtotal, feeRate);
    return { ...g, ...shipping, fee, payout: g.subtotal - fee };
  });

  const totalShipping = storeGroups.reduce((acc, g) => acc + g.shipping, 0);
  const upFee = storeGroups.reduce((acc, g) => acc + g.fee, 0);
  const payoutTotal = productsSubtotal - upFee;
  const grandTotal = grandTotalFor(productsSubtotal, totalShipping);
  return {
    storeGroups,
    totalItems,
    productsSubtotal,
    totalShipping,
    upFee,
    payoutTotal,
    grandTotal,
  };
}

export function formatCLP(amount) {
  return '$' + Math.round(amount).toLocaleString('es-CL');
}
