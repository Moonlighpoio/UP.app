/**
 * UP · Checkout simulado y comprobante de split payment 99% / 1%.
 */
import { $, esc, formatCLP } from './utils.js';
import { clearCart } from './state.js';
import { calculateCartTotals } from './cart.js';
import { showToast, closeCartDrawer, closeCheckoutModal, renderCartUI } from './ui.js';

export function processUnifiedCheckout() {
  const { storeGroups, upFee, payoutTotal, grandTotal } = calculateCartTotals();
  if (!storeGroups.length) return;
  closeCartDrawer();
  $('order-code').textContent = 'UP-CL-' + Math.floor(10000 + Math.random() * 90000);

  $('checkout-breakdown').innerHTML = storeGroups.map((g) => `
    <div class="p-3 rounded-[6px] bg-stage tech-border space-y-1 font-mono text-[11px]">
      <div class="flex items-center justify-between">
        <span class="text-white font-semibold uppercase">BOLETA ${esc(g.store.short)}</span>
        <span class="font-dot text-[16px] text-white">${formatCLP(g.subtotal + g.shipping)}</span>
      </div>
      <div class="flex justify-between text-muted text-[10px]">
        <span>${g.items.length} ÍTEM(S) · DESPACHO ${g.isFreeShipping ? 'GRATIS' : formatCLP(g.shipping)}</span>
        <span>99% → ${esc(g.store.short)}: ${formatCLP(g.payout)} · 1% → UP: ${formatCLP(g.fee)}</span>
      </div>
    </div>`).join('');

  $('checkout-fee').textContent = formatCLP(upFee);
  $('checkout-grand-total').textContent = formatCLP(grandTotal);
  $('checkout-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  showToast(`SPLIT PAYMENT: ${formatCLP(payoutTotal)} A TIENDAS · ${formatCLP(upFee)} A UP`);
}

export function finishCheckout() {
  clearCart();
  renderCartUI();
  closeCheckoutModal();
  showToast('GRACIAS POR COMPRAR EN UP');
}
