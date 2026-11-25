/** #/lista · Lista persistente y optimizador de compra (FASE U3). */
import { esc, formatCLP } from '../utils.js';
import { state as catalogState, getProduct } from '../state.js';
import { loadState, updateState } from '../storage.js';
import { trackEvent } from '../analytics.js';
import { recordAudit } from '../audit.js';
import { addToCart } from '../cart.js';
import { showToast } from '../ui.js';
import { DEFAULT_LIST_NAMES } from '../lists.js';
import {
  activeList,
  clearPurchasedItems,
  createList,
  deleteList,
  listSummary,
  removeListItem,
  renameList,
  selectList,
  updateListItem,
} from '../lists.js';
import { optimizeList } from '../optimizer.js';
import { demoBadge } from './shared.js';

let selectedScenarioId = null;

function optimizerInput(saved, list) {
  return {
    items: (list?.items || []).map((item) => ({
      productId: item.productId,
      qty: item.qty,
    })),
    products: catalogState.products,
    storesData: window.UP_DEMO_DATA?.stores || [],
    commune: saved.preferences?.commune || '',
    overrides: saved.overrides || {},
  };
}

function listOptions(saved, selectedId) {
  return (saved.lists || [])
    .map(
      (list) =>
        `<option value="${esc(list.id)}"${list.id === selectedId ? ' selected' : ''}>${esc(list.name)}</option>`
    )
    .join('');
}

function itemMarkup(item, listId) {
  const product = getProduct(item.productId);
  const name = product?.name || 'Producto no disponible';
  const category = product?.category || 'Catálogo';
  return `
    <li class="up-list-item${item.purchased ? ' is-purchased' : ''}" data-list-item="${esc(item.productId)}">
      <label class="up-list-check">
        <input type="checkbox" data-list-toggle="${esc(item.productId)}"${item.purchased ? ' checked' : ''} aria-label="Marcar ${esc(name)} como comprado" />
        <span>Comprado</span>
      </label>
      <div class="up-list-item-main">
        <a href="#/producto/${esc(item.productId)}">${esc(name)}</a>
        <span class="up-text-muted">${esc(category)}</span>
      </div>
      <label class="up-list-qty-field">
        <span>Cantidad</span>
        <input type="number" min="1" max="99" value="${Number(item.qty)}" data-list-qty="${esc(item.productId)}" aria-label="Cantidad de ${esc(name)}" />
      </label>
      <label class="up-list-notes-field">
        <span>Nota</span>
        <input type="text" maxlength="160" value="${esc(item.notes || '')}" data-list-notes="${esc(item.productId)}" placeholder="Ej.: sin azúcar" aria-label="Nota para ${esc(name)}" />
      </label>
      <button type="button" class="up-btn-secondary up-list-remove" data-list-remove="${esc(item.productId)}" aria-label="Quitar ${esc(name)} de la lista">Quitar</button>
    </li>`;
}

function unavailableScenario(id, title, description) {
  return {
    id,
    title,
    description,
    available: false,
    chainIds: [],
    assignments: {},
    missing: [],
    lines: [],
    covered: 0,
    total: null,
    productsSubtotal: 0,
    shipping: 0,
    upFee: 0,
    storeGroups: [],
    savings: 0,
    savingsPct: 0,
    savingsLabel: 'Sin precios confirmados',
  };
}

function scenarioMarkup(scenario, selected) {
  const selectedAttr = selected ? ' checked' : '';
  const disabledAttr = scenario.available ? '' : ' disabled';
  const total = scenario.available ? formatCLP(scenario.total) : 'Sin datos';
  const items = scenario.available
    ? scenario.lines
        .map((line) => {
          const product = getProduct(line.productId);
          const chain = scenario.assignments[line.productId];
          return `<li><span>${esc(product?.name || line.productId)} × ${Number(line.qty)}</span><strong class="price">${formatCLP(chain.price)}</strong></li>`;
        })
        .join('')
    : '';
  const missing = scenario.available
    ? scenario.missing
        .map(
          (item) =>
            `<li class="up-opt-missing"><span>${esc(item.name)} × ${Number(item.qty)}</span><span>${esc(item.reason)}</span></li>`
        )
        .join('')
    : '';
  const breakdown = scenario.available
    ? `<p>Productos ${formatCLP(scenario.productsSubtotal)} · despacho ${formatCLP(scenario.shipping)} · fee UP ${formatCLP(scenario.upFee)} <span class="up-text-muted">(se descuenta a la cadena, no se cobra)</span></p>
       <p class="up-opt-savings" aria-live="polite">${esc(scenario.savingsLabel)}${
         scenario.referenceTitle ? ` frente a ${esc(scenario.referenceTitle)}` : ''
       }</p>`
    : `<p class="up-text-muted">${esc(scenario.description)}</p>`;

  return `
    <article class="up-opt-card${selected ? ' is-selected' : ''}${scenario.available ? '' : ' is-unavailable'}">
      <label class="up-opt-select">
        <input type="radio" name="opt-scenario" value="${esc(scenario.id)}"${selectedAttr}${disabledAttr} />
        <span>${esc(scenario.title)}</span>
      </label>
      <p class="up-opt-description">${esc(scenario.description)}</p>
      <strong class="up-opt-total price">${total}</strong>
      ${breakdown}
      ${
        items || missing
          ? `<ul class="up-opt-items">${items}${missing}</ul>`
          : scenario.available
            ? '<p class="up-text-muted">Sin productos con precio confirmado.</p>'
            : ''
      }
      ${scenario.storeHint ? `<p class="up-opt-store">${esc(scenario.storeHint.name)} · ${esc(String(scenario.storeHint.distanceKm))} km ${demoBadge(true)}</p>` : ''}
      ${
        scenario.available
          ? `<p class="up-opt-formula">Cálculo: sólo precios verificados y frescos; despacho por cadena con envío gratis al superar el umbral; ahorro contra el escenario de referencia.</p>`
          : ''
      }
    </article>`;
}

function shell(saved, list, result) {
  const summary = listSummary(list);
  const commune = saved.preferences?.commune || '';
  const selected =
    result.scenarios.find((item) => item.id === selectedScenarioId && item.available) ||
    result.scenarios.find((item) => item.available) ||
    result.scenarios[0];
  selectedScenarioId = selected?.id || null;

  const listBody = list
    ? `<div class="up-list-toolbar">
         <label class="up-field"><span>Lista activa</span><select id="list-select">${listOptions(saved, list.id)}</select></label>
         <div class="up-list-toolbar-actions">
           <button type="button" id="rename-list-toggle" class="up-btn-secondary">Renombrar</button>
           <button type="button" id="delete-list-toggle" class="up-btn-secondary">Borrar lista</button>
         </div>
       </div>
       <form id="rename-list-form" class="up-inline-form" hidden>
         <label class="up-field"><span>Nuevo nombre</span><input name="name" maxlength="60" value="${esc(list.name)}" required /></label>
         <button type="submit" class="up-btn-primary">Guardar nombre</button>
       </form>
       <div id="delete-list-panel" class="up-inline-form" hidden>
         <p>¿Borrar «${esc(list.name)}» y sus ${summary.products} productos?</p>
         <button type="button" data-delete-confirm class="up-btn-primary">Sí, borrar</button>
         <button type="button" data-delete-cancel class="up-btn-secondary">Cancelar</button>
       </div>
       <p class="up-list-summary" aria-live="polite">${summary.products} productos · ${summary.units} unidades · ${summary.pending} por comprar</p>
       ${
         list.items.length
           ? `<ul class="up-list-items">${list.items.map((item) => itemMarkup(item, list.id)).join('')}</ul>
              <button type="button" id="clear-purchased-btn" class="up-btn-secondary"${summary.purchased ? '' : ' disabled'}>Quitar comprados (${summary.purchased})</button>`
           : `<div class="up-empty-inline"><p>Esta lista está vacía. Agrega productos desde el catálogo o usa el botón de cada tarjeta.</p><a class="up-btn-primary" href="#catalogo">Ver productos</a></div>`
       }`
    : `<div class="up-empty-inline">
         <p>Aún no tienes listas. Empieza con una de estas plantillas vacías.</p>
         <div class="up-list-examples">
           ${DEFAULT_LIST_NAMES.map(
             (name) =>
               `<button type="button" data-example-list="${esc(name)}" class="up-btn-secondary">Crear lista «${esc(name)}»</button>`
           ).join('')}
         </div>
         <p><a class="up-btn-primary" href="#catalogo">Explorar productos</a></p>
       </div>`;

  return `
    <section class="up-view-section up-container up-list-view">
      <span class="up-eyebrow">MIS COMPRAS</span>
      <h1 data-view-title tabindex="-1">Mi lista</h1>
      <p class="up-view-lead">Guarda productos, ajusta cantidades y decide dónde conviene comprar. Todo se guarda sólo en este navegador.</p>

      ${listBody}

      <form id="create-list-form" class="up-inline-form up-list-create">
        <label class="up-field"><span>Nueva lista</span><input name="name" maxlength="60" placeholder="Semanal, Fiesta…" required /></label>
        <button type="submit" class="up-btn-primary">Crear lista</button>
      </form>

      <section class="up-optimizer" aria-labelledby="optimizer-title">
        <div class="up-optimizer-head">
          <div>
            <span class="up-eyebrow">OPTIMIZADOR</span>
            <h2 id="optimizer-title">¿Dónde me conviene comprar?</h2>
          </div>
          <form id="list-location-form" class="up-inline-form">
            <label class="up-field"><span>Comuna</span><input name="commune" maxlength="80" value="${esc(commune)}" placeholder="Providencia" /></label>
            <button type="submit" class="up-btn-secondary">Guardar ubicación</button>
          </form>
        </div>
        <p class="up-text-muted">Las distancias son datos de ejemplo de UP; no inventamos sucursales ni precios reales.</p>
        ${result.message ? `<p class="up-empty-inline">${esc(result.message)}</p>` : ''}
        <div class="up-opt-grid">
          ${result.scenarios
            .map((scenario) => scenarioMarkup(scenario, scenario.id === selected?.id))
            .join('')}
        </div>
        <div class="up-optimizer-actions">
          <button type="button" id="apply-scenario-btn" class="up-btn-primary"${selected?.available ? '' : ' disabled'}>Pasar al carrito</button>
          <p class="up-text-muted" aria-live="polite">Sólo se agregan los productos con precio verificado y fresco del escenario elegido.</p>
        </div>
      </section>
    </section>`;
}

function render(container) {
  const saved = loadState();
  const list = activeList(saved);
  const result = optimizeList(optimizerInput(saved, list));
  const baseScenarios = result.scenarios.length
    ? result.scenarios
    : [
        unavailableScenario(
          'single-empty',
          'Mejor cadena única',
          'Necesitas al menos un precio verificado y fresco.'
        ),
        unavailableScenario(
          'split-empty',
          'Reparto entre 2 cadenas',
          'El reparto aparece cuando hay ofertas confirmadas en dos cadenas.'
        ),
        unavailableScenario(
          'nearest-empty',
          'Cadena más cercana',
          'Agrega precios confirmados y una comuna para ver este escenario.'
        ),
      ];
  const scenarios = baseScenarios.map((scenario) => ({
    ...scenario,
    referenceTitle: result.reference?.title || '',
  }));
  container.innerHTML = shell(saved, list, { ...result, scenarios });
  bind(container, saved, list, { ...result, scenarios });
}

function bind(container, saved, list, result) {
  container.querySelector('#create-list-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = event.currentTarget.elements.name.value;
    const created = updateState((state) => {
      const item = createList(state, name);
      if (item) {
        trackEvent(state, 'list_created', { listId: item.id });
        recordAudit(state, {
          who: 'anonimo',
          action: 'lista_creada',
          entity: 'list',
          entityId: item.id,
          after: { name: item.name },
        });
      }
      return item;
    });
    if (!created) {
      showToast('No se pudo crear la lista · revisa el nombre y el límite');
      return;
    }
    selectedScenarioId = null;
    render(container);
  });

  container.querySelectorAll('[data-example-list]').forEach((button) => {
    button.addEventListener('click', () => {
      const created = updateState((state) => {
        const item = createList(state, button.dataset.exampleList);
        if (item) trackEvent(state, 'list_created', { listId: item.id });
        return item;
      });
      if (created) render(container);
    });
  });

  container.querySelector('#list-select')?.addEventListener('change', (event) => {
    updateState((state) => selectList(state, event.target.value));
    selectedScenarioId = null;
    render(container);
  });

  container.querySelector('#rename-list-toggle')?.addEventListener('click', () => {
    const panel = container.querySelector('#rename-list-form');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) panel.elements.name.focus();
  });
  container.querySelector('#rename-list-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const ok = updateState((state) =>
      renameList(state, list.id, event.currentTarget.elements.name.value)
    );
    if (ok) render(container);
    else showToast('Escribe un nombre válido para la lista');
  });

  container.querySelector('#delete-list-toggle')?.addEventListener('click', () => {
    const panel = container.querySelector('#delete-list-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) panel.querySelector('[data-delete-cancel]').focus();
  });
  container.querySelector('[data-delete-cancel]')?.addEventListener('click', () => {
    container.querySelector('#delete-list-panel').hidden = true;
  });
  container.querySelector('[data-delete-confirm]')?.addEventListener('click', () => {
    updateState((state) => deleteList(state, list.id));
    selectedScenarioId = null;
    render(container);
  });

  container.querySelectorAll('[data-list-toggle]').forEach((input) => {
    input.addEventListener('change', () => {
      updateState((state) =>
        updateListItem(state, list.id, input.dataset.listToggle, {
          purchased: input.checked,
        })
      );
      render(container);
    });
  });
  container.querySelectorAll('[data-list-qty]').forEach((input) => {
    input.addEventListener('change', () => {
      updateState((state) =>
        updateListItem(state, list.id, input.dataset.listQty, { qty: input.value })
      );
      render(container);
    });
  });
  container.querySelectorAll('[data-list-notes]').forEach((input) => {
    input.addEventListener('change', () => {
      updateState((state) =>
        updateListItem(state, list.id, input.dataset.listNotes, { notes: input.value })
      );
      render(container);
    });
  });
  container.querySelectorAll('[data-list-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      updateState((state) => removeListItem(state, list.id, button.dataset.listRemove));
      render(container);
    });
  });
  container.querySelector('#clear-purchased-btn')?.addEventListener('click', () => {
    const removed = updateState((state) => clearPurchasedItems(state, list.id));
    if (removed) showToast(`${removed} productos comprados se quitaron de la lista`);
    render(container);
  });

  container.querySelector('#list-location-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const commune = event.currentTarget.elements.commune.value.trim();
    updateState((state) => {
      state.preferences = { ...(state.preferences || {}), commune };
    });
    render(container);
  });

  container.querySelectorAll('[name="opt-scenario"]').forEach((input) => {
    input.addEventListener('change', () => {
      selectedScenarioId = input.value;
      render(container);
    });
  });

  container.querySelector('#apply-scenario-btn')?.addEventListener('click', () => {
    const scenario = result.scenarios.find(
      (item) => item.id === selectedScenarioId && item.available
    );
    if (!scenario) return;
    Object.values(scenario.assignments).forEach((assignment) => {
      addToCart(assignment.productId, assignment.storeId, assignment.qty);
    });
    const count = Object.keys(scenario.assignments).length;
    showToast(
      scenario.missing.length
        ? `${count} productos al carrito · ${scenario.missing.length} sin precio confirmado`
        : `${count} productos al carrito · ${formatCLP(scenario.total)}`
    );
  });
}

export const listView = {
  element: 'view-dynamic',
  render,
  destroy() {
    selectedScenarioId = null;
  },
};
