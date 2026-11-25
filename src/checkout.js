/**
 * UP · Checkout simulado y comprobante de split payment 99% / 1%.
 * La matemática viene de cart.js/money.js: aquí solo se presenta y se navega.
 * FASE U5: entrega por cadena, retiro de ejemplo, pago sin tarjeta y comprobante.
 */
import { $, esc, formatCLP } from './utils.js';
import { state } from './state.js';
import { calculateCartTotals, clearCartItems } from './cart.js';
import {
  showToast,
  closeCartDrawer,
  closeCheckoutModal,
  openCartDrawer,
  renderCartUI,
} from './ui.js';
import { openDialog } from './a11y.js';
import { loadState, saveCart, updateState } from './storage.js';
import { trackEvent } from './analytics.js';
import { submitSurvey } from './surveys.js';
import {
  communeSuggestions,
  foldText,
  nearestStoreFor,
  parseAddressInput,
  slotsFor,
  validateDeliveryAddress,
  withPickupTotals,
} from './delivery.js';

const STEP_NAMES = { 1: 'Resumen', 2: 'Entrega', 3: 'Pago', 4: 'Confirmación' };
const STEP_FOCUS = {
  1: 'checkout-to-delivery',
  2: 'checkout-to-payment',
  3: 'checkout-confirm-btn',
};

const delivery = { mode: 'domicilio', address: '', commune: '', slots: {} };

function demoStores() {
  return globalThis.window?.UP_DEMO_DATA?.stores || [];
}

function getMode() {
  return document.querySelector('input[name="delivery-mode"]:checked')?.value || 'domicilio';
}

function effectiveTotals() {
  const totals = calculateCartTotals();
  return getMode() === 'retiro' ? withPickupTotals(totals) : totals;
}

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

  const help = $('checkout-fee-help');
  if (help) {
    help.hidden = true;
    $('checkout-fee-info')?.setAttribute('aria-expanded', 'false');
  }
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

function renderDeliveryOptions() {
  const saved = loadState();
  const addresses = saved.addresses || [];
  const communes = communeSuggestions({
    addresses,
    commune: saved.preferences?.commune || '',
    limit: 50,
  });
  $('checkout-commune-options').innerHTML = communes
    .map((commune) => `<option value="${esc(commune)}"></option>`)
    .join('');

  $('checkout-saved-addresses').innerHTML = addresses.length
    ? `<p class="up-text-muted">Direcciones guardadas en este navegador</p>
       <div class="up-checkout-saved-list">${addresses
         .map(
           (address) => `<button type="button" class="up-btn-secondary" data-address-id="${esc(
             address.id
           )}">
             ${esc(address.label || 'Dirección')} · ${esc(address.street)}, ${esc(address.commune)}
           </button>`
         )
         .join('')}</div>`
    : '<p class="up-text-muted">Sin direcciones guardadas. Al confirmar, esta se conserva sólo en tu navegador.</p>';

  const input = $('checkout-address');
  if (!input.value && saved.preferences?.commune) input.value = saved.preferences.commune;
}

function renderSlots() {
  const addresses = loadState().addresses || [];
  const parsed = parseAddressInput($('checkout-address').value, { addresses });
  delivery.mode = getMode();
  delivery.commune = parsed.commune;
  const { storeGroups } = calculateCartTotals();
  const stores = demoStores();

  if (!storeGroups.length) {
    $('checkout-slots').innerHTML =
      '<p class="up-text-muted">Agrega productos al carrito para ver las franjas.</p>';
    return;
  }

  $('checkout-slots').innerHTML = storeGroups
    .map((group) => {
      const slots = slotsFor(group.store.id, delivery.mode);
      if (!delivery.slots[group.store.id]) delivery.slots[group.store.id] = slots[0].id;
      const nearest =
        delivery.mode === 'retiro'
          ? nearestStoreFor({ storesData: stores, commune: parsed.commune, chain: group.store.id })
          : null;
      const nearestMarkup =
        delivery.mode === 'retiro'
          ? `<p class="up-slot-nearest">
              <span class="up-demo-tag">Ejemplo</span>
              ${
                nearest
                  ? `${esc(nearest.name)} · ${esc(nearest.comuna)} · ${Number(
                      nearest.distanceKm
                    ).toLocaleString('es-CL')} km`
                  : 'Sin sucursal de ejemplo para esa comuna'
              }
            </p>`
          : '';
      return `
      <fieldset class="up-slot-group">
        <legend>${esc(group.store.name)}</legend>
        ${nearestMarkup}
        <div class="up-slot-options">
          ${slots
            .map(
              (slot) => `<label class="up-slot-option">
                <input
                  type="radio"
                  name="slot-${esc(group.store.id)}"
                  value="${esc(slot.id)}"
                  data-store-id="${esc(group.store.id)}"
                  ${delivery.slots[group.store.id] === slot.id ? 'checked' : ''}
                />
                <span>${esc(slot.label)}</span>
              </label>`
            )
            .join('')}
        </div>
        <small>Franja ilustrativa · disponibilidad no real.</small>
      </fieldset>`;
    })
    .join('');
}

function selectedSlots() {
  return calculateCartTotals()
    .storeGroups.map((group) => {
      const slots = slotsFor(group.store.id, delivery.mode);
      const slot = slots.find((item) => item.id === delivery.slots[group.store.id]) || slots[0];
      return slot
        ? { storeId: group.store.id, storeName: group.store.name, label: slot.label }
        : null;
    })
    .filter(Boolean);
}

function selectedNearestStores() {
  if (delivery.mode !== 'retiro') return [];
  const addresses = loadState().addresses || [];
  const parsed = parseAddressInput($('checkout-address').value, { addresses });
  return calculateCartTotals()
    .storeGroups.map((group) => {
      const nearest = nearestStoreFor({
        storesData: demoStores(),
        commune: parsed.commune,
        chain: group.store.id,
      });
      return nearest
        ? {
            storeId: group.store.id,
            name: nearest.name,
            commune: nearest.comuna,
            distanceKm: Number(nearest.distanceKm),
            isDemo: true,
          }
        : null;
    })
    .filter(Boolean);
}

function validateStep2() {
  const addresses = loadState().addresses || [];
  const raw = $('checkout-address').value;
  const parsed = parseAddressInput(raw, { addresses });
  const result = validateDeliveryAddress({
    street: parsed.street,
    commune: parsed.commune,
    mode: getMode(),
    addresses,
  });
  const error = Object.values(result.errors).join(' ');
  $('checkout-address-error').textContent = error;
  if (!result.ok) {
    $('checkout-address').focus({ preventScroll: true });
    return false;
  }
  delivery.mode = getMode();
  delivery.address = raw.trim();
  delivery.commune = parsed.commune;
  return true;
}

function renderCostBreakdown() {
  const { storeGroups, productsSubtotal, upFee, payoutTotal } = effectiveTotals();
  const isPickup = delivery.mode === 'retiro';
  const totalShipping = isPickup ? 0 : storeGroups.reduce((sum, group) => sum + group.shipping, 0);
  const grandTotal = productsSubtotal + totalShipping;

  $('checkout-cost-breakdown').innerHTML = `
    <div class="up-breakdown-row">
      <span>Productos (${storeGroups.length} supermercado${storeGroups.length === 1 ? '' : 's'})</span>
      <strong>${formatCLP(productsSubtotal)}</strong>
    </div>
    <div class="up-breakdown-row">
      <span>Despacho ${isPickup ? '(retiro sin despacho)' : ''}</span>
      <strong>${isPickup ? 'Gratis' : formatCLP(totalShipping)}</strong>
    </div>
    <div class="up-breakdown-row">
      <span>Fee UP (1% retenido, no se agrega)</span>
      <strong>${formatCLP(upFee)}</strong>
    </div>
    <div class="up-breakdown-row">
      <span>99% liquidado a supermercados</span>
      <strong>${formatCLP(payoutTotal)}</strong>
    </div>
    <div class="up-summary-total">
      <span>Total a pagar</span>
      <strong class="price">${formatCLP(grandTotal)}</strong>
    </div>`;
  document.querySelectorAll('[data-checkout-total]').forEach((el) => {
    el.textContent = formatCLP(grandTotal);
  });
}

/** Abre el asistente en Resumen sin alterar el carrito ni los totales. */
export function startCheckout() {
  const { storeGroups, totalItems, grandTotal } = calculateCartTotals();
  if (!storeGroups.length) return;

  closeCartDrawer();
  delivery.slots = {};
  const preferredDelivery = loadState().preferences?.delivery === 'retiro' ? 'retiro' : 'domicilio';
  document.querySelector(`input[name="delivery-mode"][value="${preferredDelivery}"]`).checked =
    true;
  document.querySelectorAll('input[name="survey-rating"]').forEach((input) => {
    input.checked = false;
  });
  $('checkout-survey-note').textContent = 'Sólo se guarda localmente para el panel.';
  $('checkout-address-error').textContent = '';
  renderCheckoutSummary();
  renderDeliveryOptions();
  renderSlots();
  $('checkout-receipt').hidden = true;
  $('checkout-wizard').hidden = false;
  showStep(1);
  openDialog($('checkout-modal'), 'checkout-to-delivery');
  updateState((saved) =>
    trackEvent(saved, 'checkout_start', {
      items: totalItems,
      chains: storeGroups.length,
      total: grandTotal,
      demo: true,
    })
  );
}

function toggleFeeHelp() {
  const help = $('checkout-fee-help');
  const open = help.hidden;
  help.hidden = !open;
  $('checkout-fee-info').setAttribute('aria-expanded', String(open));
}

export function initCheckout() {
  $('checkout-to-delivery').addEventListener('click', () => goToCheckoutStep(2));
  $('checkout-to-payment').addEventListener('click', () => {
    if (!validateStep2()) {
      goToCheckoutStep(2);
      return;
    }
    renderCostBreakdown();
    goToCheckoutStep(3);
  });
  $('checkout-back-to-summary').addEventListener('click', () => goToCheckoutStep(1));
  $('checkout-back-to-delivery').addEventListener('click', () => goToCheckoutStep(2));
  $('checkout-back-to-cart').addEventListener('click', () => {
    closeCheckoutModal();
    openCartDrawer();
  });
  $('checkout-confirm-btn').addEventListener('click', processUnifiedCheckout);
  $('finish-order-btn').addEventListener('click', finishCheckout);
  $('print-receipt-btn').addEventListener('click', () => globalThis.window?.print());
  $('checkout-fee-info').addEventListener('click', toggleFeeHelp);
  document.querySelectorAll('input[name="survey-rating"]').forEach((input) => {
    input.addEventListener('change', () => {
      const code = $('order-code').textContent.trim();
      const saved = updateState((state) =>
        submitSurvey(state, { orderId: code, rating: Number(input.value) })
      );
      $('checkout-survey-note').textContent = saved
        ? 'Gracias. Tu respuesta de prueba quedó guardada en este navegador.'
        : 'Esta orden ya tiene una respuesta guardada.';
    });
  });

  document.querySelectorAll('input[name="delivery-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      $('checkout-address-error').textContent = '';
      renderSlots();
    });
  });
  $('checkout-address').addEventListener('input', () => {
    $('checkout-address-error').textContent = '';
    renderSlots();
  });
  $('checkout-saved-addresses').addEventListener('click', (event) => {
    const button = event.target.closest('[data-address-id]');
    if (!button) return;
    const address = (loadState().addresses || []).find(
      (item) => item.id === button.dataset.addressId
    );
    if (!address) return;
    $('checkout-address').value = `${address.street}, ${address.commune}`;
    $('checkout-address-error').textContent = '';
    renderSlots();
  });
  $('checkout-slots').addEventListener('change', (event) => {
    const storeId = event.target.dataset.storeId;
    if (storeId) delivery.slots[storeId] = event.target.value;
  });
}

export function processUnifiedCheckout() {
  if (!validateStep2()) {
    goToCheckoutStep(2);
    return;
  }
  const totals = calculateCartTotals();
  const { storeGroups } = totals;
  if (!storeGroups.length) return;

  const effective = effectiveTotals();
  const slots = selectedSlots();
  const nearestStores = selectedNearestStores();
  const now = new Date();
  const code = `UP-DEMO-${now.getTime().toString(36).slice(-6).toUpperCase()}`;
  const order = {
    id: code,
    isDemo: true,
    label: 'Ejemplo',
    createdAt: now.toISOString(),
    status: 'preparando',
    deliveryMode: delivery.mode,
    address: {
      id: `addr_checkout_${now.getTime().toString(36)}`,
      label: 'Ejemplo',
      street: delivery.address,
      commune: delivery.commune,
      isDemo: true,
    },
    payment: { method: 'simulado', label: 'Pago simulado · sin tarjeta', isDemo: true },
    slots,
    nearestStores,
    storeGroups: effective.storeGroups.map((group) => ({
      storeId: group.store.id,
      storeName: group.store.name,
      items: group.items.map((item) => ({
        productId: item.productId,
        name: item.product.name,
        qty: item.qty,
        unitPrice: item.unitPrice,
      })),
      subtotal: group.subtotal,
      shipping: group.shipping,
      fee: group.fee,
      payout: group.payout,
      total: group.subtotal + group.shipping,
    })),
    productsSubtotal: effective.productsSubtotal,
    totalShipping: effective.totalShipping,
    upFee: effective.upFee,
    payoutTotal: effective.payoutTotal,
    grandTotal: effective.grandTotal,
  };

  $('order-code').textContent = code;
  $('checkout-breakdown').innerHTML = effective.storeGroups
    .map(
      (group) => `
    <div class="up-breakdown-row">
      <div>
        <b>${esc(group.store.name)}</b>
        <small>${group.items.length} producto${group.items.length === 1 ? '' : 's'} · despacho ${
          group.shipping === 0 ? 'gratis' : formatCLP(group.shipping)
        }</small>
        <small>99% → ${esc(group.store.short)}: ${formatCLP(group.payout)} · 1% → UP: ${formatCLP(
          group.fee
        )}</small>
      </div>
      <strong class="price">${formatCLP(group.subtotal + group.shipping)}</strong>
    </div>`
    )
    .join('');
  $('checkout-fee').textContent = formatCLP(effective.upFee);
  $('checkout-grand-total').textContent = formatCLP(effective.grandTotal);
  $('checkout-receipt-meta').innerHTML = `
    <div><dt>Modo</dt><dd><span class="up-demo-tag">Ejemplo</span> orden de demostración</dd></div>
    <div><dt>Entrega</dt><dd>${esc(
      delivery.mode === 'retiro' ? 'Retiro en tienda' : 'Despacho a domicilio'
    )} · ${esc(delivery.address)}</dd></div>
    <div><dt>Franjas</dt><dd>${esc(
      slots.map((slot) => `${slot.storeName}: ${slot.label}`).join(' · ')
    )}</dd></div>
    <div><dt>Pago</dt><dd>Pago simulado · sin tarjeta</dd></div>`;

  $('checkout-wizard').hidden = true;
  $('checkout-receipt').hidden = false;
  showStep(4);
  openDialog($('checkout-modal'), 'close-checkout-modal');

  updateState((saved) => {
    saved.orders = [order, ...(Array.isArray(saved.orders) ? saved.orders : [])].slice(0, 100);
    const addresses = Array.isArray(saved.addresses) ? saved.addresses : [];
    const key = foldText(`${order.address.street}|${order.address.commune}`);
    if (!addresses.some((item) => foldText(`${item.street}|${item.commune}`) === key)) {
      saved.addresses = [...addresses, order.address].slice(-10);
    }
    trackEvent(saved, 'checkout_complete', {
      items: totals.totalItems,
      chains: storeGroups.length,
      total: effective.grandTotal,
      mode: delivery.mode,
      demo: true,
    });
  });

  showToast(
    `SPLIT PAYMENT: ${formatCLP(effective.payoutTotal)} A TIENDAS · ${formatCLP(
      effective.upFee
    )} A UP · MODO PRUEBA`
  );
}

export function finishCheckout() {
  clearCartItems({ notifyUndo: false });
  saveCart(state.cart);
  renderCartUI();
  closeCheckoutModal();
  $('checkout-wizard').hidden = false;
  $('checkout-receipt').hidden = true;
  showStep(1);
  showToast('GRACIAS POR COMPRAR EN UP · COMPRA SIMULADA');
}
