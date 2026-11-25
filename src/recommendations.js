/**
 * UP · "Comprar de nuevo" (FASE U4). Función pura sobre pedidos de prueba.
 * Sólo recomienda productos presentes en el catálogo y en pedidos entregados.
 */

export function buyAgainProducts(orders = [], products = [], limit = 6) {
  const stats = new Map();
  orders
    .filter((order) => order?.status === 'entregado')
    .forEach((order) => {
      (order.storeGroups || []).forEach((group) => {
        (group.items || []).forEach((item) => {
          const product = products.find((entry) => entry.id === item.productId);
          if (!product) return;
          const current = stats.get(item.productId) || {
            product,
            times: 0,
            units: 0,
            last: null,
          };
          current.times += 1;
          current.units += Math.max(1, Number(item.qty) || 1);
          if (!current.last || Date.parse(order.createdAt) > Date.parse(current.last.at)) {
            current.last = {
              storeId: group.storeId,
              unitPrice: item.unitPrice,
              qty: Math.max(1, Number(item.qty) || 1),
              at: order.createdAt,
            };
          }
          stats.set(item.productId, current);
        });
      });
    });
  return [...stats.values()]
    .sort(
      (a, b) =>
        b.times - a.times || b.units - a.units || Date.parse(b.last.at) - Date.parse(a.last.at)
    )
    .slice(0, Math.max(0, limit))
    .map((item) => ({
      productId: item.product.id,
      name: item.product.name,
      times: item.times,
      units: item.units,
      storeId: item.last.storeId,
      qty: item.last.qty,
      unitPrice: item.last.unitPrice,
    }));
}

/** Delega en addToCart para preservar carritos por cadena y el fee del 1%. */
export function addBuyAgainToCart(items, addToCart) {
  let count = 0;
  items.forEach((item) => {
    if (!item.storeId) return;
    addToCart(item.productId, item.storeId, item.qty);
    count += 1;
  });
  return count;
}
