/**
 * UP · Emisores de analítica desde la interfaz (FASE U7).
 * Sólo identificadores de catálogo y cantidades: nunca correos, nombres,
 * direcciones ni datos de sesión. Persisten en `up_state_v2.analytics`.
 */
import { trackEvent } from './analytics.js';
import { updateState } from './storage.js';

const viewed = new Set();
const storeClicks = new Set();

function emit(event, props) {
  updateState((state) => trackEvent(state, event, { ...props, demo: true }));
}

/** Un producto se contabiliza una vez por sesión de página, aunque se reabre. */
export function recordProductView(productId) {
  const id = String(productId || '');
  if (!id || viewed.has(id)) return false;
  viewed.add(id);
  emit('view_product', { productId: id });
  return true;
}

export function recordAddToCart(productId, storeId, qty = 1) {
  const id = String(productId || '');
  if (!id || !storeId) return false;
  emit('add_to_cart', { productId: id, storeId, qty: Number(qty) || 1 });
  return true;
}

/** Un clic por producto y cadena para no inflar el KPI con reingresos. */
export function recordStoreClick(productId, chain) {
  const id = String(productId || '');
  const key = `${id}_${chain}`;
  if (!id || !chain || storeClicks.has(key)) return false;
  storeClicks.add(key);
  emit('click_store_link', { productId: id, storeId: chain });
  return true;
}
