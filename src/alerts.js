/**
 * UP · Alertas de precio y notificaciones internas (FASE U4).
 * Evalúan sólo ofertas verificadas y frescas. Sin correos ni datos personales.
 */
import { STATIC_DEMO, STORES } from './config.js';
import { isVerifiedFresh } from './freshness.js';
import { formatCLP } from './money.js';
import { trackEvent } from './analytics.js';
import { overrideKey } from './reports.js';

export const MAX_ALERTS = 100;
export const MAX_NOTIFICATIONS = 100;

function randomId(prefix, now) {
  return `${prefix}_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createAlert(state, input = {}, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const productId = String(input.productId || '');
  const chain = String(input.chain || '');
  const targetPrice = Number(input.targetPrice);
  if (!productId || !STORES[chain] || !Number.isFinite(targetPrice) || targetPrice < 1) return null;
  const alerts = Array.isArray(state.alerts) ? state.alerts : [];
  if (alerts.length >= MAX_ALERTS) return null;
  const alert = {
    id: randomId('alert', now),
    productId,
    chain,
    targetPrice: Math.round(targetPrice),
    createdAt: new Date(now).toISOString(),
    active: true,
  };
  state.alerts = [...alerts, alert];
  trackEvent(state, 'alert_created', {
    productId,
    chain,
    targetPrice: alert.targetPrice,
  });
  return alert;
}

export function removeAlert(state, id) {
  const alerts = Array.isArray(state.alerts) ? state.alerts : [];
  const next = alerts.filter((alert) => alert.id !== id);
  if (next.length === alerts.length) return false;
  state.alerts = next;
  return true;
}

/** Crea notificaciones cuando una oferta confirmada alcanza el umbral. */
export function evaluateAlerts(state, products = [], options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const alerts = Array.isArray(state.alerts) ? state.alerts : [];
  const notifications = Array.isArray(state.notifications) ? state.notifications : [];
  let created = 0;
  alerts.forEach((alert) => {
    if (!alert.active || !STORES[alert.chain]) return;
    const product = products.find((item) => item.id === alert.productId);
    const price = product?.prices?.[alert.chain];
    if (!product || !Number.isFinite(price) || price <= 0) return;
    if (state.overrides?.[overrideKey(alert.productId, alert.chain)]?.status === 'pending') return;
    const sku = { ...(product.skus?.[alert.chain] || {}) };
    if (!isVerifiedFresh(sku, { now })) return;
    if (price > alert.targetPrice) return;
    const key = `${alert.id}_${price}`;
    if (notifications.some((item) => item.key === key)) return;
    notifications.push({
      id: randomId('notice', now + created),
      key,
      alertId: alert.id,
      productId: alert.productId,
      chain: alert.chain,
      price,
      targetPrice: alert.targetPrice,
      at: new Date(now).toISOString(),
      isDemo: STATIC_DEMO,
      read: false,
      message: `${product.name} en ${STORES[alert.chain].name}: ${formatCLP(price)} (umbral ${formatCLP(alert.targetPrice)}).`,
    });
    created += 1;
  });
  if (created) state.notifications = notifications.slice(-MAX_NOTIFICATIONS);
  return created;
}

export function unreadCount(state) {
  return (state.notifications || []).filter((item) => item.read !== true).length;
}

export function markAllRead(state) {
  state.notifications = (state.notifications || []).map((item) => ({ ...item, read: true }));
}

export function clearNotifications(state) {
  state.notifications = [];
}
