/** Área de cuenta de prueba: resumen, pedidos, direcciones, favoritos y perfil. */
import { esc } from '../utils.js';
import { loadState, updateState, clearPersonalData } from '../storage.js';
import { logoutUser, sessionUser, isSessionValid } from '../auth.js';
import { getProduct } from '../state.js';
import { getProductStats } from '../catalog.js';
import { showToast } from '../ui.js';
import {
  accountNotice,
  accountShell,
  clearFormErrors,
  demoBadge,
  formatDate,
  formatDateTime,
  money,
  showFormErrors,
  sourceNote,
  statusBadge,
  updateAuthLinks,
} from './shared.js';
import { bindTracking, destroyTracking, trackingMarkup } from './tracking.js';
import { getBankBenefit } from '../demo-content.js';

function sortedOrders(state) {
  return [...state.orders].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function estimatedSavings(orders) {
  return orders.reduce(
    (total, order) =>
      total +
      order.storeGroups.reduce(
        (sum, group) =>
          sum +
          group.items.reduce((itemSum, item) => {
            const product = getProduct(item.productId);
            const stats = product && getProductStats(product);
            const difference = stats ? Math.max(0, stats.maxPrice - item.unitPrice) : 0;
            return itemSum + difference * item.qty;
          }, 0),
        0
      ),
    0
  );
}

function renderShell(container, active, body) {
  container.innerHTML = accountShell(active, body);
}

function bindCommon(container) {
  container.onclick = (event) => {
    if (event.target.closest('[data-logout]')) {
      updateState((state) => logoutUser(state));
      updateAuthLinks();
      showToast('Sesión de prueba cerrada');
      globalThis.location.hash = '#/';
      return;
    }
    const clearToggle = event.target.closest('[data-clear-toggle]');
    if (clearToggle) {
      const panel = container.querySelector('#clear-data-panel');
      panel.hidden = !panel.hidden;
      if (!panel.hidden) panel.querySelector('[data-clear-cancel]')?.focus();
      return;
    }
    if (event.target.closest('[data-clear-cancel]')) {
      container.querySelector('#clear-data-panel').hidden = true;
      return;
    }
    if (event.target.closest('[data-clear-confirm]')) {
      clearPersonalData();
      updateAuthLinks();
      showToast('Datos personales de prueba borrados');
      globalThis.location.hash = '#/';
    }
  };
}

function summaryBody() {
  const state = loadState();
  const user = sessionUser(state);
  const orders = sortedOrders(state);
  const last = orders[0];
  return `
    <div class="up-section-head up-section-head--account">
      <span class="up-eyebrow">RESUMEN</span>
      <h1>Hola, ${esc(user?.name || 'prueba')}</h1>
      <p>Tu actividad de demostración en UP.</p>
    </div>
    ${accountNotice()}
    <div class="up-account-cards">
      <section class="up-account-card">
        <span class="up-eyebrow">ÚLTIMO PEDIDO</span>
        ${
          last
            ? `<strong>${esc(last.id)}</strong>
               <p>${formatDate(last.createdAt)} · ${esc(last.storeGroups.map((g) => g.storeName).join(', '))}</p>
               ${statusBadge(last.status)} ${demoBadge(last.isDemo)}
               <p class="up-account-card-link"><a href="#/cuenta/pedidos/${encodeURIComponent(last.id)}">Ver detalle →</a></p>`
            : '<p>Aún no hay pedidos.</p><p><a href="#/">Ir a comprar →</a></p>'
        }
      </section>
      <section class="up-account-card">
        <span class="up-eyebrow">AHORRO ESTIMADO</span>
        <strong class="price">${money(estimatedSavings(orders))}</strong>
        <p>Estimación frente al precio más alto del catálogo de demostración.</p>
      </section>
      <section class="up-account-card">
        <span class="up-eyebrow">ACCESOS RÁPIDOS</span>
        <ul class="up-quick-links">
          <li><a href="#/cuenta/pedidos">Ver todos mis pedidos →</a></li>
          <li><a href="#/cuenta/direcciones">Gestionar direcciones →</a></li>
          <li><a href="#/cuenta/beneficios">Beneficios favoritos →</a></li>
          <li><a href="#/ofertas">Ver ofertas →</a></li>
        </ul>
      </section>
    </div>
    <section class="up-account-panel">
      <h2>Borrar mis datos de prueba</h2>
      <p>Elimina usuarios, sesión, direcciones y favoritos de este navegador. Los pedidos etiquetados "Ejemplo" se conservan.</p>
      <button type="button" class="up-btn-secondary" data-clear-toggle>Mostrar opción de borrado</button>
      <div id="clear-data-panel" class="up-clear-panel" hidden>
        <p><strong>¿Borrar todos tus datos personales de prueba?</strong> Esta acción no se puede deshacer.</p>
        <button type="button" class="up-btn-danger" data-clear-confirm>Sí, borrar mis datos</button>
        <button type="button" class="up-btn-secondary" data-clear-cancel>Cancelar</button>
      </div>
    </section>`;
}

function ordersBody() {
  const state = loadState();
  const orders = sortedOrders(state);
  return `
    <div class="up-section-head up-section-head--account">
      <span class="up-eyebrow">HISTORIAL</span>
      <h1>Mis pedidos</h1>
      <p>${orders.length} pedido${orders.length === 1 ? '' : 's'} en este navegador, del más reciente al más antiguo.</p>
    </div>
    ${accountNotice()}
    ${
      orders.length
        ? `<ul class="up-order-list">${orders
            .map(
              (order) => `
            <li class="up-order-row">
              <div class="up-order-row-main">
                <strong>${esc(order.id)}</strong>
                ${demoBadge(order.isDemo)}
                <p>${formatDateTime(order.createdAt)}</p>
                <p class="up-text-muted">${esc(order.storeGroups.map((g) => g.storeName).join(' · '))} · ${order.storeGroups.reduce((n, g) => n + g.items.length, 0)} productos</p>
              </div>
              <div class="up-order-row-side">
                ${statusBadge(order.status)}
                <strong class="price">${money(order.grandTotal)}</strong>
                <a href="#/cuenta/pedidos/${encodeURIComponent(order.id)}">Ver detalle →</a>
              </div>
            </li>`
            )
            .join('')}</ul>`
        : '<div class="up-empty-inline"><p>No tienes pedidos todavía.</p><a class="up-btn-primary" href="#/">Ir a comprar</a></div>'
    }`;
}

function orderDetailBody(id) {
  const state = loadState();
  const order = state.orders.find((item) => item.id === id);
  if (!order) {
    return `
      <div class="up-section-head up-section-head--account">
        <span class="up-eyebrow">PEDIDO</span>
        <h1>No encontramos ese pedido</h1>
      </div>
      <p><a href="#/cuenta/pedidos">Volver a mis pedidos →</a></p>`;
  }
  return `
    <div class="up-section-head up-section-head--account">
      <span class="up-eyebrow">DETALLE DEL PEDIDO</span>
      <h1>${esc(order.id)}</h1>
      <p>${formatDateTime(order.createdAt)} · ${statusBadge(order.status)} ${demoBadge(order.isDemo)}</p>
    </div>
    ${accountNotice()}
    ${trackingMarkup(order)}
    <div class="up-order-groups">
      ${order.storeGroups
        .map(
          (group) => `
        <section class="up-account-panel">
          <h2>${esc(group.storeName)}</h2>
          <ul class="up-order-items">
            ${group.items
              .map(
                (item) =>
                  `<li><span>${esc(item.name)} · ${item.qty} × ${money(item.unitPrice)}</span><strong class="price">${money(item.qty * item.unitPrice)}</strong></li>`
              )
              .join('')}
          </ul>
          <div class="up-order-totals">
            <p><span>Subtotal</span><strong>${money(group.subtotal)}</strong></p>
            <p><span>Despacho</span><strong>${money(group.shipping)}</strong></p>
            <p><span>Fee UP (1% retenido)</span><strong>${money(group.fee)}</strong></p>
            <p><strong>Total del subpedido</strong><strong class="price">${money(group.total)}</strong></p>
          </div>
        </section>`
        )
        .join('')}
    </div>
    <section class="up-account-panel">
      <h2>Resumen</h2>
      <p>Tipo de entrega: ${esc(order.deliveryMode === 'retiro' ? 'Retiro en tienda' : 'Despacho a domicilio')}</p>
      <p>Dirección: ${esc(order.address?.street || '—')}, ${esc(order.address?.commune || '—')} ${demoBadge(order.address?.isDemo)}</p>
      <p>Total pagado: <strong class="price">${money(order.grandTotal)}</strong> · Comisión UP: ${money(order.upFee)}</p>
      <p class="up-text-muted">Los importes son de demostración; el seguimiento usa datos ficticios etiquetados como «Ejemplo».</p>
    </section>
    <p><a href="#/cuenta/pedidos">← Volver a mis pedidos</a></p>`;
}

function addressesBody() {
  const state = loadState();
  return `
    <div class="up-section-head up-section-head--account">
      <span class="up-eyebrow">DIRECCIONES</span>
      <h1>Mis direcciones</h1>
      <p>Datos de prueba guardados sólo en este navegador.</p>
    </div>
    ${accountNotice()}
    <ul class="up-address-list">
      ${
        state.addresses.length
          ? state.addresses
              .map(
                (address) => `
          <li class="up-account-panel">
            <strong>${esc(address.label || 'Dirección')}</strong>
            ${address.isDefault ? '<span class="up-chip">Predeterminada</span>' : ''}
            <p>${esc(address.street)} · ${esc(address.commune)}</p>
            <div class="up-address-actions">
              <button type="button" class="up-link-btn" data-address-default="${esc(address.id)}">Hacer predeterminada</button>
              <button type="button" class="up-link-btn" data-address-edit="${esc(address.id)}">Editar</button>
              <button type="button" class="up-link-btn" data-address-remove="${esc(address.id)}">Eliminar</button>
            </div>
          </li>`
              )
              .join('')
          : '<li class="up-empty-inline">Aún no guardas direcciones de prueba.</li>'
      }
    </ul>
    <section class="up-account-panel">
      <h2 id="address-form-title">Agregar dirección</h2>
      <form id="address-form" novalidate>
        <input type="hidden" name="id" />
        <label class="up-field"><span>Etiqueta</span><input name="label" type="text" placeholder="Casa (prueba)" /></label>
        <label class="up-field"><span>Calle y número</span><input name="street" type="text" placeholder="Dirección de ejemplo" /></label>
        <label class="up-field"><span>Comuna</span><input name="commune" type="text" placeholder="Providencia" /></label>
        <label class="up-check-field"><input name="isDefault" type="checkbox" /><span>Usar como dirección predeterminada</span></label>
        <div class="up-form-actions">
          <button type="submit" class="up-btn-primary">Guardar dirección</button>
          <button type="button" class="up-btn-secondary" id="address-reset">Cancelar edición</button>
        </div>
      </form>
    </section>`;
}

function benefitsBody() {
  const state = loadState();
  const favorites = state.favoriteBenefits.map((id) => getBankBenefit(id)).filter((item) => !!item);
  return `
    <div class="up-section-head up-section-head--account">
      <span class="up-eyebrow">TARJETAS FAVORITAS</span>
      <h1>Beneficios de interés</h1>
      <p>UP nunca solicita números de tarjeta, vencimiento ni CVV.</p>
    </div>
    ${accountNotice()}
    ${
      favorites.length
        ? `<ul class="up-favorite-list">${favorites
            .map(
              (item) => `
            <li>
              <div class="up-favorite-main">
                <strong>${esc(item.title)} ${demoBadge(item.isDemo)}</strong>
                <p>${esc(item.bank)} · ${esc(item.conditions)}</p>
                ${sourceNote(item)}
              </div>
              <button type="button" class="up-btn-secondary" data-benefit-remove="${esc(item.id)}">
                Quitar de favoritos
              </button>
            </li>`
            )
            .join('')}</ul>`
        : '<div class="up-empty-inline"><p>Aún no has marcado beneficios.</p><p>Los beneficios disponibles son ejemplos con su procedencia declarada.</p><a class="up-btn-primary" href="#/tarjetas">Ver beneficios</a></div>'
    }`;
}

function bindBenefits(container) {
  container.querySelectorAll('[data-benefit-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      updateState((state) => {
        state.favoriteBenefits = state.favoriteBenefits.filter(
          (id) => id !== button.dataset.benefitRemove
        );
      });
      renderShell(container, 'beneficios', benefitsBody());
      bindCommon(container);
      bindBenefits(container);
      showToast('Beneficio quitado de favoritos');
    });
  });
}

function profileBody() {
  const state = loadState();
  const user = sessionUser(state);
  const expires = state.session?.expiresAt;
  return `
    <div class="up-section-head up-section-head--account">
      <span class="up-eyebrow">PERFIL</span>
      <h1>Datos de la cuenta</h1>
    </div>
    ${accountNotice()}
    <section class="up-account-panel">
      <dl class="up-profile-list">
        <div><dt>Nombre</dt><dd>${esc(user?.name || '—')}</dd></div>
        <div><dt>Correo</dt><dd>${esc(user?.email || '—')}</dd></div>
        <div><dt>Sesión válida hasta</dt><dd>${isSessionValid(state.session) ? formatDateTime(expires) : 'Sesión expirada'}</dd></div>
      </dl>
      <button type="button" class="up-btn-secondary" data-logout>Cerrar sesión</button>
    </section>
    <section class="up-account-panel">
      <h2>Borrar mis datos de prueba</h2>
      <p>Elimina usuarios, sesión, direcciones y favoritos guardados en este navegador.</p>
      <button type="button" class="up-btn-secondary" data-clear-toggle>Mostrar opción de borrado</button>
      <div id="clear-data-panel" class="up-clear-panel" hidden>
        <p><strong>¿Borrar todos tus datos personales de prueba?</strong></p>
        <button type="button" class="up-btn-danger" data-clear-confirm>Sí, borrar mis datos</button>
        <button type="button" class="up-btn-secondary" data-clear-cancel>Cancelar</button>
      </div>
    </section>`;
}

function bindAddresses(container) {
  const form = container.querySelector('#address-form');
  const resetBtn = container.querySelector('#address-reset');

  function resetForm() {
    form.reset();
    container.querySelector('#address-form-title').textContent = 'Agregar dirección';
    clearFormErrors(form);
  }

  resetBtn.onclick = resetForm;

  form.onsubmit = (event) => {
    event.preventDefault();
    clearFormErrors(form);
    const errors = [];
    const street = form.elements.street.value.trim();
    const commune = form.elements.commune.value.trim();
    if (street.length < 4)
      errors.push({
        field: 'street',
        message: 'Escribe una dirección de ejemplo de al menos 4 caracteres.',
      });
    if (commune.length < 2) errors.push({ field: 'commune', message: 'Escribe una comuna.' });
    if (errors.length) {
      showFormErrors(form, errors);
      return;
    }
    updateState((state) => {
      const id = form.elements.id.value || `dir_${globalThis.crypto?.randomUUID?.() || Date.now()}`;
      const existing = state.addresses.find((address) => address.id === id);
      const address = {
        id,
        label: form.elements.label.value.trim() || 'Dirección',
        street,
        commune,
        isDefault: form.elements.isDefault.checked || !state.addresses.length,
        isDemo: false,
      };
      if (existing) Object.assign(existing, address);
      else state.addresses.push(address);
      if (address.isDefault) {
        state.addresses.forEach((item) => {
          item.isDefault = item.id === id;
        });
      }
    });
    showToast('Dirección guardada en este navegador');
    resetForm();
    const state = loadState();
    // Re-render de la sección para reflejar cambios sin recargar la vista.
    renderShell(container, 'direcciones', addressesBody(state));
    bindCommon(container);
    bindAddresses(container);
  };

  container.querySelectorAll('[data-address-edit]').forEach((button) => {
    button.onclick = () => {
      const address = loadState().addresses.find((item) => item.id === button.dataset.addressEdit);
      if (!address) return;
      form.elements.id.value = address.id;
      form.elements.label.value = address.label || '';
      form.elements.street.value = address.street;
      form.elements.commune.value = address.commune;
      form.elements.isDefault.checked = !!address.isDefault;
      container.querySelector('#address-form-title').textContent = 'Editar dirección';
      form.elements.street.focus();
    };
  });
  container.querySelectorAll('[data-address-remove]').forEach((button) => {
    button.onclick = () => {
      updateState((state) => {
        state.addresses = state.addresses.filter(
          (item) => item.id !== button.dataset.addressRemove
        );
        if (state.addresses.length && !state.addresses.some((item) => item.isDefault)) {
          state.addresses[0].isDefault = true;
        }
      });
      renderShell(container, 'direcciones', addressesBody());
      bindCommon(container);
      bindAddresses(container);
      showToast('Dirección eliminada');
    };
  });
  container.querySelectorAll('[data-address-default]').forEach((button) => {
    button.onclick = () => {
      updateState((state) => {
        state.addresses.forEach((item) => {
          item.isDefault = item.id === button.dataset.addressDefault;
        });
      });
      renderShell(container, 'direcciones', addressesBody());
      bindCommon(container);
      bindAddresses(container);
      showToast('Dirección predeterminada actualizada');
    };
  });
}

function mount(container, active, body, afterBind) {
  renderShell(container, active, body);
  bindCommon(container);
  afterBind?.(container);
}

export const accountView = {
  element: 'view-dynamic',
  render(container) {
    mount(container, 'resumen', summaryBody());
  },
  destroy() {},
};

export const ordersView = {
  element: 'view-dynamic',
  render(container) {
    mount(container, 'pedidos', ordersBody());
  },
  destroy() {},
};

export const orderDetailView = {
  element: 'view-dynamic',
  render(container, { params }) {
    mount(container, 'pedidos', orderDetailBody(params.id), (el) => {
      const order = loadState().orders.find((item) => item.id === params.id);
      bindTracking(el, order);
    });
  },
  destroy() {
    destroyTracking();
  },
};

export const addressesView = {
  element: 'view-dynamic',
  render(container) {
    mount(container, 'direcciones', addressesBody(), bindAddresses);
  },
  destroy() {},
};

export const benefitsView = {
  element: 'view-dynamic',
  render(container) {
    mount(container, 'beneficios', benefitsBody(), bindBenefits);
  },
  destroy() {},
};

export const profileView = {
  element: 'view-dynamic',
  render(container) {
    mount(container, 'perfil', profileBody());
  },
  destroy() {},
};
