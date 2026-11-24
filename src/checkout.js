/**
 * UP · Checkout simulado y comprobante de split payment 99% / 1%.
 * La matemática viene de cart.js/money.js: aquí solo se presenta y se navega.
 */
import { $, esc, formatCLP } from './utils.js';
import { clearCart } from './state.js';
import { calculateCartTotals } from './cart.js';
import {
  showToast,
  closeCartDrawer,
  closeCheckoutModal,
  openCartDrawer,
  renderCartUI,
} from './ui.js';
import { openDialog } from './a11y.js';

const STEP_NAMES = { 1: 'Resumen', 2: 'Entrega', 3: 'Pago', 4: 'Confirmación' };
const STEP_FOCUS = {
  1: 'checkout-to-delivery',
  2: 'checkout-to-payment',
  3: 'checkout-confirm-btn',
};

function showStep(step) {
  const title = $('checkout-title');
  title.textContent = step === 4 ? 'Orden confirmada' : `Paso ${step} de 4 · ${STEP_NAMES[step]}`;

  document.querySelectorAll('[data-step-panel]').forEach((panel) => {
    panel.hidden = Number(panel.dataset.stepPanel) !== step;
  });
  document.querySelectorAll('[data-step-label]').forEach((label) => {
    const number = Number(label.dataset.stepLabel);
    label.classList.toggle('up-active', number === step);
    label.classList.toggle('up-done', number < step);
    if (number === step) label.setAttribute('aria-current', 'step');
    else label.removeAttribute('aria-current');
  });
}

function focusStep(step) {
  const id = STEP_FOCUS[step];
  if (!id) return;
  requestAnimationFrame(() => $(id)?.focus({ preventScroll: true }));
}

function goToCheckoutStep(step) {
  showStep(step);
  focusStep(step);
}

function renderCheckoutSummary() {
  const { storeGroups, grandTotal } = calculateCartTotals();
  $('checkout-summary-list').innerHTML = storeGroups
    .map(
      (group) => `
      <div class="up-breakdown-row">
        <div>
          <b>${esc(group.store.name)}</b>
          <small>${group.items.length} producto${group.items.length === 1 ? '' : 's'} · despacho ${
            group.isFreeShipping ? 'gratis' : formatCLP(group.shipping)
          }</small>
        </div>
        <strong class="price">${formatCLP(group.subtotal + group.shipping)}</strong>
      </div>`
    )
    .join('');
  document.querySelectorAll('[data-checkout-total]').forEach((el) => {
    el.textContent = formatCLP(grandTotal);
  });
}

/** Abre el asistente en Resumen sin alterar el carrito ni los totales. */
export function startCheckout() {
  const { storeGroups } = calculateCartTotals();
  if (!storeGroups.length) return;

  closeCartDrawer();
  renderCheckoutSummary();
  $('checkout-receipt').hidden = true;
  $('checkout-wizard').hidden = false;
  showStep(1);
  openDialog($('checkout-modal'), 'checkout-to-delivery');
}

export function initCheckout() {
  $('checkout-to-delivery').addEventListener('click', () => goToCheckoutStep(2));
  $('checkout-to-payment').addEventListener('click', () => goToCheckoutStep(3));
  $('checkout-back-to-summary').addEventListener('click', () => goToCheckoutStep(1));
  $('checkout-back-to-delivery').addEventListener('click', () => goToCheckoutStep(2));
  $('checkout-back-to-cart').addEventListener('click', () => {
    closeCheckoutModal();
    openCartDrawer();
  });
  $('checkout-confirm-btn').addEventListener('click', processUnifiedCheckout);
}

export function processUnifiedCheckout() {
  const { storeGroups, upFee, payoutTotal, grandTotal } = calculateCartTotals();
  if (!storeGroups.length) return;
  closeCartDrawer();
  $('order-code').textContent = 'UP-CL-' + Math.floor(10000 + Math.random() * 90000);

  $('checkout-breakdown').innerHTML = storeGroups
    .map(
      (g) => `
    <div class="up-breakdown-row">
      <div>
        <b>${esc(g.store.name)}</b>
        <small>${g.items.length} producto${g.items.length === 1 ? '' : 's'} · despacho ${
          g.isFreeShipping ? 'gratis' : formatCLP(g.shipping)
        }</small>
        <small>99% → ${esc(g.store.short)}: ${formatCLP(g.payout)} · 1% → UP: ${formatCLP(g.fee)}</small>
      </div>
      <strong class="price">${formatCLP(g.subtotal + g.shipping)}</strong>
    </div>`
    )
    .join('');

  $('checkout-fee').textContent = formatCLP(upFee);
  $('checkout-grand-total').textContent = formatCLP(grandTotal);
  $('checkout-wizard').hidden = true;
  $('checkout-receipt').hidden = false;
  showStep(4);
  openDialog($('checkout-modal'), 'close-checkout-modal');
  showToast(`SPLIT PAYMENT: ${formatCLP(payoutTotal)} A TIENDAS · ${formatCLP(upFee)} A UP`);
}

export function finishCheckout() {
  clearCart();
  renderCartUI();
  closeCheckoutModal();
  $('checkout-wizard').hidden = false;
  $('checkout-receipt').hidden = true;
  showStep(1);
  showToast('GRACIAS POR COMPRAR EN UP');
}
