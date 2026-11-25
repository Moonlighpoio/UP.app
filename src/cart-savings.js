/**
 * UP · Ahorro informativo del carrito (FASE U5).
 * Compara contra el precio más alto disponible en el catálogo de demostración.
 * Nunca afirma que ese precio esté verificado ni que sea el "mejor precio".
 */
import { formatCLP } from './money.js';

export function cartSavings({ lines = [], products = [], stores = {} } = {}) {
  const byId = new Map(products.map((product) => [product.id, product]));
  let baseline = 0;
  let selected = 0;
  let comparableItems = 0;

  lines.forEach((line) => {
    const product = byId.get(line.productId);
    if (!product || !product.prices) return;
    const price = product.prices[line.storeId];
    const alternatives = Object.entries(product.prices)
      .filter(([storeId, value]) => stores[storeId] && Number.isFinite(value))
      .map(([, value]) => value);
    if (!Number.isFinite(price) || alternatives.length < 2) return;
    const highest = Math.max(...alternatives);
    baseline += highest * line.qty;
    selected += price * line.qty;
    comparableItems += 1;
  });

  const amount = Math.max(0, baseline - selected);
  const percent = baseline > 0 ? Math.round((amount / baseline) * 100) : 0;
  return {
    amount,
    baseline,
    selected,
    comparableItems,
    percent,
    label: comparableItems
      ? `Ahorras ${formatCLP(amount)} estimados (${percent}%) frente al precio más alto de referencia`
      : 'Sin precios suficientes para estimar un ahorro',
  };
}
