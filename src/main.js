/**
 * UP · Punto de entrada del front-end.
 * Solo cablea módulos y eventos: la lógica vive en src/*.js.
 */
import { $, esc } from './utils.js';
import { state, getProduct } from './state.js';
import { loadState, saveCart, updateState } from './storage.js';
import { didYouMean, suggestionsFor } from './suggest.js';
import { clearRecentSearches, popularSearches, recentSearches, recordSearch } from './search.js';
import { initScanner, closeScanner } from './scanner.js';
import { sessionUser } from './auth.js';
import { ensureDemoAccounts } from './demo-accounts.js';
import { createRouter } from './router.js';
import { applyDemoData } from './catalog.js';
import { refreshPrices } from './api.js';
import { initCart, undoLastCartChange } from './cart.js';
import { initCompare, openCompareModal, closeCompareModal } from './compare.js';
import { initReportUI, openReportDialog } from './report-ui.js';
import { initListUI, closeListDialog, openListDialog } from './list-ui.js';
import { initComparePicker } from './compare-picker.js';
import {
  initNotificationsUI,
  renderNotifications,
  closeNotifications,
} from './notifications-ui.js';
import { evaluateAlerts } from './alerts.js';
import { finishCheckout, initCheckout, startCheckout } from './checkout.js';
import { initPWA } from './pwa.js';
import { closeOnboarding, initOnboarding, isOnboardingOpen } from './onboarding.js';
import { initPrivacyNotice } from './privacy.js';
import { recordStoreClick } from './analytics-ui.js';
import { lazyView } from './lazy-view.js';
import {
  applyUrlFilters,
  clearFilter,
  freeShippingChainIds,
  matchesFilters,
  priceBounds,
  resetAllFilters,
  syncUrlFilters,
} from './filters.js';
import { trapDialogTab } from './a11y.js';
import {
  showToast,
  renderCategories,
  renderChainStrip,
  renderChainFilter,
  renderFilterControls,
  renderProducts,
  openFilterSheet,
  closeFilterSheet,
  renderCartUI,
  initUI,
  resetProductPaging,
  showMoreProducts,
  openCartDrawer,
  closeCartDrawer,
  closeCheckoutModal,
} from './ui.js';
import { homeView } from './views/home.js';
import { productView } from './views/product.js';
import { loginView } from './views/login.js';
import { registerView } from './views/register.js';
import {
  accountView,
  ordersView,
  orderDetailView,
  addressesView,
  benefitsView,
  favoritesView,
  profileView,
} from './views/account.js';
import { checkoutView } from './views/checkout.js';
import { offersView } from './views/offers.js';
import { bankBenefitsView } from './views/bank-benefits.js';
import { adminView } from './views/admin.js';
import { storesPlaceholder } from './views/placeholder.js';
import { listView } from './views/list.js';
import { compareView } from './views/compare.js';
import { notFoundView } from './views/not-found.js';
import { helpView } from './views/help.js';
import { updateAuthLinks } from './views/shared.js';

function renderAll() {
  renderCategories();
  renderChainStrip();
  renderChainFilter();
  renderProducts();
  renderCartUI();
  renderFilterControls();
}

function isHomeHash() {
  const hash = (globalThis.location.hash || '').split('?')[0];
  return !hash || hash === '#/' || hash === '#';
}

/** El acceso «Buscar» de la nav inferior enfoca el buscador ya existente. */
const searchFocusView = {
  element: 'view-dynamic',
  render(container) {
    container.innerHTML = `
      <section class="up-view-section up-container">
        <span class="up-eyebrow">BUSCAR</span>
        <h1 data-view-title tabindex="-1">Buscar productos</h1>
        <p>Selecciona el campo de búsqueda para ver sugerencias y resultados.</p>
      </section>`;
    globalThis.setTimeout(() => {
      if (globalThis.location.hash !== '#/buscar') return;
      globalThis.location.hash = '#/';
      globalThis.setTimeout(() => $('main-search-input')?.focus({ preventScroll: true }), 0);
    }, 0);
  },
};

function updateBottomNav(path) {
  let active = 'home';
  if (path === '/buscar') active = 'search';
  else if (path === '/ofertas' || path === '/tarjetas') active = 'ofertas';
  else if (path === '/lista' || path === '/comparar') active = 'lista';
  else if (
    path.startsWith('/cuenta') ||
    path.startsWith('/admin') ||
    path === '/login' ||
    path === '/registro'
  )
    active = 'cuenta';
  document.querySelectorAll('#bottom-nav [data-nav]').forEach((link) => {
    if (link.dataset.nav === active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

/** En rutas profundas no renderizamos las 30 tarjetas del catálogo oculto. */
function renderForRoute() {
  if (isHomeHash() || $('product-grid')?.children.length) {
    renderAll();
    return;
  }
  renderCartUI();
  renderFilterControls();
}

function refreshActiveModal() {
  if (state.activeProductId && !$('compare-modal').classList.contains('hidden')) {
    openCompareModal(state.activeProductId);
  }
}

function initDeferredUI(onDetected) {
  initCart({
    notify: showToast,
    notifyUndo: (label) =>
      showToast(`${label}. Puedes deshacer durante 5 s.`, {
        actionLabel: 'Deshacer',
        onAction: undoLastCartChange,
        timeout: 5000,
      }),
    render: () => {
      renderCartUI();
      saveCart(state.cart);
    },
  });
  initUI({ onOpenCompare: openCompareModal, onAddToList: openListDialog });
  initCompare({ notify: showToast });
  initReportUI({ notify: showToast });
  initListUI({ notify: showToast });
  initComparePicker();
  initNotificationsUI();
  initScanner({ notify: showToast, onDetected });
  initCheckout();
  initPWA();
  initOnboarding();
  initPrivacyNotice();
}

function initApp() {
  state.cart = loadState().cart;
  // Siembra idempotente de las cuentas públicas de prueba (FASE P1).
  void ensureDemoAccounts();

  const priceHooks = { notify: showToast, renderAll: renderForRoute, refreshActiveModal };

  const demo = window.UP_DEMO_DATA;
  if (demo) applyDemoData(demo);
  applyUrlFilters(window.location.search);

  renderForRoute();
  refreshPrices(true, priceHooks).then(() => {
    const triggered = updateState((saved) => evaluateAlerts(saved, state.products));
    if (triggered) renderNotifications();
  });

  const searchInput = $('main-search-input');
  const clearSearchBtn = $('clear-search-btn');
  const suggestions = $('search-suggestions');
  let suggestionItems = [];
  let suggestionIndex = -1;

  function syncFilterInputs() {
    searchInput.value = state.searchQuery;
    clearSearchBtn.classList.toggle('hidden', !state.searchQuery);
    $('sort-select').value = state.sortBy;
  }

  function popoverPanel(trigger) {
    return document.getElementById(trigger.getAttribute('aria-controls'));
  }

  function closePopovers() {
    document.querySelectorAll('[data-popover-trigger]').forEach((trigger) => {
      trigger.setAttribute('aria-expanded', 'false');
      const panel = popoverPanel(trigger);
      if (panel) panel.hidden = true;
    });
  }

  function togglePopover(trigger) {
    const panel = popoverPanel(trigger);
    if (!panel) return;
    const shouldOpen = panel.hidden;
    closePopovers();
    panel.hidden = !shouldOpen;
    trigger.setAttribute('aria-expanded', String(shouldOpen));
  }

  const resultCount = () => state.products.filter(matchesFilters).length;
  let searchTimer = null;

  function applySearchValue(value) {
    searchInput.value = value;
    state.searchQuery = value;
    clearSearchBtn.classList.remove('hidden');
    hideSuggestions();
    refreshFilters();
    recordCurrentSearch(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function recordCurrentSearch(force = false) {
    const query = state.searchQuery.trim();
    if (query.length < 2) return;
    updateState((saved) => recordSearch(saved, query, resultCount(), { force }));
  }

  function refreshFilters() {
    resetProductPaging();
    renderCategories();
    renderChainFilter();
    renderProducts();
    renderFilterControls();
    syncUrlFilters();
  }

  syncFilterInputs();

  function hideSuggestions() {
    suggestions.hidden = true;
    suggestions.innerHTML = '';
    suggestionItems = [];
    suggestionIndex = -1;
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.removeAttribute('aria-activedescendant');
  }

  function paintSuggestionState() {
    Array.from(suggestions.querySelectorAll('li[role="option"]')).forEach((li, index) => {
      const active = index === suggestionIndex;
      li.classList.toggle('up-active', active);
      li.setAttribute('aria-selected', String(active));
    });
    const active = suggestions.querySelector('li[role="option"][aria-selected="true"]');
    if (active) searchInput.setAttribute('aria-activedescendant', active.id);
    else searchInput.removeAttribute('aria-activedescendant');
  }

  function showSuggestions() {
    const query = state.searchQuery.trim();
    const saved = loadState();
    suggestionItems = suggestionsFor(query, state.products, {
      recent: recentSearches(saved),
      popular: popularSearches(saved),
    });
    suggestionIndex = -1;

    let html = suggestionItems
      .map(
        (item, index) => `
        <li role="option" id="search-suggestion-${index}" data-suggestion-index="${index}">
          <span><b>${esc(item.label)}</b>${item.type === 'producto' && item.meta ? ` <small>${esc(item.meta)}</small>` : ''}</span>
          <small class="up-suggestion-type">${esc(
            {
              producto: 'Producto',
              marca: 'Marca',
              categoria: 'Categoría',
              reciente: 'Reciente',
              popular: 'Popular',
            }[item.type] || item.type
          )}</small>
        </li>`
      )
      .join('');

    if (query.length >= 2 && !suggestionItems.length) {
      const correction = didYouMean(query, state.products);
      if (correction) {
        suggestionItems = [{ type: 'correccion', label: correction, value: correction }];
        html = `<li role="option" id="search-suggestion-0" data-suggestion-index="0">
          <span>¿Quisiste decir <b>${esc(correction)}</b>?</span>
          <small class="up-suggestion-type">Sugerencia</small>
        </li>`;
      }
    }

    if (query.length < 2 && !suggestionItems.length) return hideSuggestions();
    if (!suggestionItems.length) return hideSuggestions();

    html += `<li role="presentation" class="up-suggestion-actions">
      <button type="button" data-clear-recent>Borrar búsquedas recientes</button>
    </li>`;
    suggestions.innerHTML = html;
    suggestions.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
    paintSuggestionState();
  }

  function chooseSuggestion(index) {
    const item = suggestionItems[index];
    if (!item) return;
    searchInput.value = item.value;
    state.searchQuery = item.value;
    hideSuggestions();
    clearSearchBtn.classList.remove('hidden');
    refreshFilters();
    recordCurrentSearch(true);
  }

  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    clearSearchBtn.classList.toggle('hidden', !state.searchQuery);
    showSuggestions();
    refreshFilters();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => recordCurrentSearch(), 600);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideSuggestions();
      return;
    }
    if (suggestions.hidden || !suggestionItems.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestionIndex = (suggestionIndex + 1) % suggestionItems.length;
      paintSuggestionState();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestionIndex = (suggestionIndex - 1 + suggestionItems.length) % suggestionItems.length;
      paintSuggestionState();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      chooseSuggestion(suggestionIndex >= 0 ? suggestionIndex : 0);
    }
  });

  suggestions.addEventListener('click', (e) => {
    if (e.target.closest('[data-clear-recent]')) {
      e.stopPropagation();
      updateState(clearRecentSearches);
      showSuggestions();
      return;
    }
    const item = e.target.closest('li[data-suggestion-index]');
    if (item) chooseSuggestion(Number(item.dataset.suggestionIndex));
  });

  document.addEventListener('click', (e) => {
    const storeLink = e.target.closest('[data-store-link]');
    if (storeLink) {
      recordStoreClick(
        storeLink.dataset.productId || state.activeProductId,
        storeLink.dataset.storeId
      );
    }

    const trigger = e.target.closest('[data-popover-trigger]');
    if (trigger) {
      togglePopover(trigger);
      return;
    }

    const choice = e.target.closest('[data-filter-choice]');
    if (choice) {
      const kind = choice.dataset.filterChoice;
      const value = choice.dataset.filterValue;
      if (kind === 'chain') state.selectedChain = value;
      else if (kind === 'delivery') state.maxDelivery = Number(value);
      else if (kind === 'availability') state.availability = value;
      refreshFilters();
      closePopovers();
      return;
    }

    const toggle = e.target.closest('[data-toggle-filter]');
    if (toggle) {
      if (toggle.dataset.toggleFilter === 'offers') {
        state.offersOnly = !state.offersOnly;
      } else if (toggle.dataset.toggleFilter === 'shipping') {
        if (!freeShippingChainIds().length) {
          showToast('AGREGA PRODUCTOS PARA DESBLOQUEAR DESPACHO GRATIS');
          return;
        }
        state.freeShippingOnly = !state.freeShippingOnly;
      }
      refreshFilters();
      return;
    }

    const chipClear = e.target.closest('[data-clear-filter]');
    if (chipClear) {
      clearFilter(chipClear.dataset.clearFilter);
      syncFilterInputs();
      refreshFilters();
      return;
    }

    const emptySuggestion = e.target.closest('[data-empty-suggestion]');
    if (emptySuggestion) {
      applySearchValue(emptySuggestion.dataset.emptySuggestion);
      return;
    }

    if (
      e.target.closest('#reset-filters-btn') ||
      e.target.closest('#clear-filters-btn') ||
      e.target.closest('#clear-sheet-filters-btn')
    ) {
      resetAllFilters();
      syncFilterInputs();
      refreshFilters();
      return;
    }

    if (e.target.closest('#open-filters-btn')) {
      openFilterSheet();
      return;
    }
    if (e.target.closest('#apply-filters-btn') || e.target.closest('#close-filter-sheet-btn')) {
      closeFilterSheet();
      return;
    }
    if (e.target.id === 'filter-sheet-backdrop') {
      closeFilterSheet();
      return;
    }

    if (!e.target.closest('.up-filter-popover')) closePopovers();
    if (!e.target.closest('.up-search')) hideSuggestions();
  });

  // Doble pulgar: el slider escribe exactamente el mismo estado que los campos numéricos.
  document.querySelectorAll('[data-range-input]').forEach((input) => {
    input.addEventListener('input', () => {
      const bounds = priceBounds();
      const value = Number(input.value);
      if (input.dataset.rangeInput === 'min') {
        state.minPrice = value <= bounds.min ? 0 : Math.min(value, state.maxPrice);
      } else {
        state.maxPrice = value >= bounds.max ? Infinity : Math.max(value, state.minPrice);
      }
      refreshFilters();
    });
  });

  document.querySelectorAll('[data-filter-input]').forEach((input) => {
    input.addEventListener('change', () => {
      const raw = input.value.trim();
      const value = raw === '' ? NaN : Number(raw);
      if (input.dataset.filterInput === 'min-price') {
        state.minPrice = Number.isFinite(value) ? Math.max(0, value) : 0;
        if (state.minPrice > state.maxPrice) state.maxPrice = state.minPrice;
      } else {
        state.maxPrice = Number.isFinite(value) ? Math.max(0, value) : Infinity;
        if (state.maxPrice < state.minPrice) state.minPrice = state.maxPrice;
      }
      refreshFilters();
    });
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    clearSearchBtn.classList.add('hidden');
    hideSuggestions();
    refreshFilters();
  });

  $('nav-search-btn').addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    searchInput.focus();
    showSuggestions();
  });

  $('dismiss-demo-bar').addEventListener('click', () => {
    $('demo-banner').classList.add('hidden');
  });

  // Sombra sutil del header al desplazarse (solo capa visual).
  const siteHeader = document.querySelector('.up-site-header');
  const syncHeaderShadow = () => siteHeader.classList.toggle('is-scrolled', window.scrollY > 4);
  window.addEventListener('scroll', syncHeaderShadow, { passive: true });
  syncHeaderShadow();

  $('sort-select').addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    refreshFilters();
  });

  $('reset-filters-btn').addEventListener('click', () => {
    resetAllFilters();
    syncFilterInputs();
    refreshFilters();
  });

  $('load-more-btn').addEventListener('click', showMoreProducts);

  $('refresh-prices-btn').addEventListener('click', () => refreshPrices(false, priceHooks));

  window.addEventListener('popstate', () => {
    applyUrlFilters(window.location.search);
    syncFilterInputs();
    closeFilterSheet();
    closePopovers();
    refreshFilters();
  });

  $('report-compare-price').addEventListener('click', () => {
    openReportDialog(state.activeProductId || '');
  });
  $('close-compare-modal').addEventListener('click', closeCompareModal);
  $('compare-modal').addEventListener('click', (e) => {
    if (e.target.id === 'compare-modal') closeCompareModal();
  });

  $('open-cart-btn').addEventListener('click', openCartDrawer);
  $('dock-open-cart-btn').addEventListener('click', openCartDrawer);
  $('footer-cart-link').addEventListener('click', openCartDrawer);
  $('close-cart-btn').addEventListener('click', closeCartDrawer);
  $('cart-drawer-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'cart-drawer-backdrop') closeCartDrawer();
  });

  $('checkout-btn').addEventListener('click', () => {
    if (!sessionUser(loadState())) {
      closeCartDrawer();
      showToast('Ingresa o regístrate para continuar con el pago');
      const target = '#/login?next=' + encodeURIComponent('#/checkout');
      if (router) router.navigate(target);
      else window.location.hash = target;
      return;
    }
    if (router) router.navigate('#/checkout');
    else startCheckout();
  });
  $('close-checkout-modal').addEventListener('click', closeCheckoutModal);
  $('finish-order-btn').addEventListener('click', finishCheckout);

  document.querySelectorAll('.accordion-trigger').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const content = trigger.nextElementSibling;
      const icon = trigger.querySelector('.accordion-icon');
      const isOpen = !content.classList.contains('hidden');
      document.querySelectorAll('.accordion-content').forEach((c) => c.classList.add('hidden'));
      document.querySelectorAll('.accordion-icon').forEach((i) => {
        i.textContent = '+';
      });
      document.querySelectorAll('.accordion-trigger').forEach((b) => {
        b.setAttribute('aria-expanded', 'false');
      });
      if (!isOpen) {
        content.classList.remove('hidden');
        icon.textContent = '−';
        trigger.setAttribute('aria-expanded', 'true');
      }
    });
  });

  const routes = [
    {
      path: '/',
      view: homeView,
      element: 'view-home',
      title: 'UP — Comparador de Supermercados Chile | Pago Unificado',
      description:
        'Compara precios de supermercados en Chile, arma carritos por cadena y paga en un solo lugar.',
    },
    {
      path: '/producto/:id',
      view: productView,
      title: (params) => {
        const product = getProduct(params.id);
        return product ? `${product.name} · UP` : 'Producto no encontrado · UP';
      },
      description: (params) => {
        const product = getProduct(params.id);
        return product
          ? product.description || 'Ficha de producto de UP.'
          : 'Producto no encontrado.';
      },
    },
    {
      path: '/ofertas',
      view: offersView,
      preserve: true,
      seal: 'seal-ofertas',
      title: 'Ofertas y eventos · UP',
      description:
        'Ofertas y eventos de ejemplo en UP, con procedencia declarada. No son ofertas comerciales reales.',
    },
    {
      path: '/tarjetas',
      view: bankBenefitsView,
      preserve: true,
      seal: 'seal-tarjetas',
      title: 'Beneficios bancarios · UP',
      description:
        'Beneficios bancarios de ejemplo en UP. Sin datos de tarjeta, vencimiento ni CVV.',
    },
    { path: '/tiendas', view: storesPlaceholder, title: 'Tiendas y mapa · UP' },
    {
      path: '/lista',
      view: listView,
      title: 'Mi lista · UP',
      description: 'Lista de compra local y optimizador de precios verificados de UP.',
    },
    {
      path: '/comparar',
      view: compareView,
      title: 'Comparar productos · UP',
      description: 'Compara hasta 3 productos por cadena, precio por unidad y formato.',
    },
    { path: '/buscar', view: searchFocusView, title: 'Buscar productos · UP' },
    {
      path: '/ayuda',
      view: helpView,
      title: 'Ayuda y preguntas frecuentes · UP',
      description: 'Preguntas frecuentes y contacto simulado de UP. No envía mensajes.',
    },
    {
      path: '/ayuda/datos',
      view: lazyView(() => import('./views/data-help.js'), {
        title: 'Cargando información de precios…',
      }),
      title: 'Cómo obtenemos los precios · UP',
      description: 'Fuentes, frecuencia y significado de las etiquetas de precios en UP.',
    },
    { path: '/login', view: loginView, title: 'Ingresar · UP' },
    { path: '/registro', view: registerView, title: 'Crear cuenta · UP' },
    { path: '/cuenta', view: accountView, title: 'Mi cuenta · UP' },
    { path: '/cuenta/pedidos', view: ordersView, title: 'Mis pedidos · UP' },
    {
      path: '/cuenta/pedidos/:id',
      view: orderDetailView,
      title: (params) => `Pedido ${params.id} · UP`,
    },
    { path: '/cuenta/favoritos', view: favoritesView, title: 'Mis favoritos · UP' },
    { path: '/cuenta/direcciones', view: addressesView, title: 'Mis direcciones · UP' },
    { path: '/cuenta/beneficios', view: benefitsView, title: 'Beneficios favoritos · UP' },
    { path: '/cuenta/perfil', view: profileView, title: 'Mi perfil · UP' },
    {
      path: '/checkout',
      view: checkoutView,
      focus: false,
      title: 'Pago simulado · UP',
      description: 'Pago simulado de UP. No se solicitan datos de tarjeta.',
    },
    { path: '/admin', view: adminView('resumen'), title: 'Panel UP · Resumen' },
    { path: '/admin/funciones', view: adminView('funciones'), title: 'Panel UP · Funciones' },
    { path: '/admin/catalogo', view: adminView('catalogo'), title: 'Panel UP · Catálogo' },
    { path: '/admin/datos', view: adminView('datos'), title: 'Panel UP · Calidad de datos' },
    { path: '/admin/reportes', view: adminView('reportes'), title: 'Panel UP · Reportes' },
    { path: '/admin/alertas', view: adminView('alertas'), title: 'Panel UP · Alertas' },
    { path: '/admin/pedidos', view: adminView('pedidos'), title: 'Panel UP · Pedidos' },
    {
      path: '/admin/config',
      view: adminView('config'),
      adminOnly: true,
      title: 'Panel UP · Configuración',
    },
    { path: '/admin/auditoria', view: adminView('auditoria'), title: 'Panel UP · Auditoría' },
    { path: '*', view: notFoundView, title: 'Página no encontrada · UP' },
  ];

  const router = createRouter({
    routes,
    getSession: () => sessionUser(loadState()),
    getRole: () => sessionUser(loadState())?.role || null,
    onBefore: ({ path }) => {
      if (path === '/' && !$('product-grid').children.length) renderProducts();
      if (isOnboardingOpen()) closeOnboarding();
      closePopovers();
      hideSuggestions();
      closeFilterSheet();
      closeCompareModal();
      closeCartDrawer();
      closeScanner();
      closeListDialog();
      closeNotifications();
      $('report-modal').classList.add('hidden');
    },
    onAfter: ({ path }) => {
      if (path === '/') syncFilterInputs();
      updateAuthLinks();
      updateBottomNav(path);
    },
  });

  updateAuthLinks();
  router.start();

  requestAnimationFrame(() => {
    if (globalThis.requestIdleCallback) {
      globalThis.requestIdleCallback(() => initDeferredUI((value) => applySearchValue(value)), {
        timeout: 1000,
      });
    } else {
      setTimeout(() => initDeferredUI((value) => applySearchValue(value)), 0);
    }
  });

  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target.isContentEditable;

    if (e.key === '/' && !typing && $('filter-sheet-backdrop').classList.contains('hidden')) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      searchInput.focus();
      return;
    }

    if (e.key === 'Escape') {
      if (!suggestions.hidden) hideSuggestions();
      closePopovers();
      closeFilterSheet();
      closeCompareModal();
      closeCartDrawer();
      closeCheckoutModal();
      closeScanner();
      closeListDialog();
      closeNotifications();
      closeOnboarding();
      if (!$('report-modal').classList.contains('hidden')) {
        $('report-modal').classList.add('hidden');
        document.body.style.overflow = '';
      }
      return;
    }
    trapDialogTab(e);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp, { once: true });
} else {
  initApp();
}
