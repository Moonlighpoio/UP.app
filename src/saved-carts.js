/**
 * UP · Carritos guardados para después (FASE U5).
 * Sólo datos del navegador: sin correos, sin cuenta y sin inventario externo.
 */
export const MAX_SAVED_CARTS = 12;

export function makeSavedCart({ name = '', items = [] } = {}, { now = Date.now() } = {}) {
  const cleanName = String(name).trim().slice(0, 60);
  if (!cleanName || !Array.isArray(items) || !items.length) return null;
  return {
    id: `save_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: cleanName,
    items: items.map((item) => ({
      key: `${item.productId}_${item.storeId}`,
      productId: String(item.productId),
      storeId: String(item.storeId),
      qty: Math.max(1, Math.min(99, Math.round(Number(item.qty) || 1))),
    })),
    savedAt: new Date(now).toISOString(),
  };
}

export function addSavedCart(list = [], saved) {
  if (!saved) return Array.isArray(list) ? list : [];
  return [saved, ...(Array.isArray(list) ? list : [])].slice(0, MAX_SAVED_CARTS);
}

export function removeSavedCart(list = [], id = '') {
  return (Array.isArray(list) ? list : []).filter((item) => item?.id !== id);
}

export function findSavedCart(list = [], id = '') {
  return (Array.isArray(list) ? list : []).find((item) => item?.id === id) || null;
}
