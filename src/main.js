/**
 * UP · Punto de entrada del front-end.
 * Solo cablea módulos y eventos: la lógica vive en src/*.js.
 */
import { $, esc, norm } from './utils.js';
import { state, getProduct } from './state.js';
import { loadState, saveCart } from './storage.js';
import { sessionUser } from './auth.js';
import { createRouter } from './router.js';
import { applyDemoData } from './catalog.js';
import { refreshPrices } from './api.js';
import { initCart } from './cart.js';
import { initCompare, openCompareModal, closeCompareModal } from './compare.js';
import { finishCheckout, initCheckout, startCheckout } from './checkout.js';
import {
  applyUrlFilters,
  clearFilter,
  freeShippingChainIds,
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
  profileView,
} from './views/account.js';
import { checkoutView } from './views/checkout.js';
import { offersView } from './views/offers.js';
import { bankBenefitsView } from './views/bank-benefits.js';
import { storesPlaceholder } from './views/placeholder.js';
import { notFoundView } from './views/not-found.js';
import { updateAuthLinks } from './views/shared.js';

function renderAll() {
  renderCategories();
  renderChainStrip();
  renderChainFilter();
  renderProducts();
  renderCartUI();
  renderFilterControls();
}

function refreshActiveModal() {
  if (state.activeProductId && !$('compare-modal').classList.contains('hidden')) {
    openCompareModal(state.activeProductId);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  state.cart = loadState().cart;

  initCart({
    notify: showToast,
    render: () => {
      renderCartUI();
      saveCart(state.cart);
    },
  });
  initUI({ onOpenCompare: openCompareModal });
  initCompare({ notify: showToast });
  initCheckout();

  const priceHooks = { notify: showToast, renderAll, refreshActiveModal };

  const demo = window.UP_DEMO_DATA;
  if (demo) applyDemoData(demo);
  applyUrlFilters(window.location.search);

  renderAll();
  refreshPrices(true, priceHooks);

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
  }

  function paintSuggestionState() {
    Array.from(suggestions.children).forEach((li, index) => {
      const active = index === suggestionIndex;
      li.classList.toggle('up-active', active);
      li.setAttribute('aria-selected', String(active));
    });
  }

  function showSuggestions() {
    const query = norm(state.searchQuery.trim());
    if (query.length < 2) return hideSuggestions();

    suggestionItems = state.products
      .filter((product) =>
        norm(`${product.name} ${product.category} ${product.unit}`).includes(query)
      )
      .slice(0, 6);

    if (!suggestionItems.length) return hideSuggestions();

    suggestionIndex = -1;
    suggestions.innerHTML = suggestionItems
      .map(
        (product, index) => `
        <li role="option" id="search-suggestion-${index}" data-product-id="${esc(product.id)}">
          <span>${esc(product.name)}</span>
          <small>${esc(product.category)}</small>
        </li>`
      )
      .join('');
    suggestions.hidden = false;
    paintSuggestionState();
  }

  function chooseSuggestion(index) {
    const product = suggestionItems[index];
    if (!product) return;
    searchInput.value = product.name;
    state.searchQuery = product.name;
    hideSuggestions();
    clearSearchBtn.classList.remove('hidden');
    refreshFilters();
  }

  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    clearSearchBtn.classList.toggle('hidden', !state.searchQuery);
    showSuggestions();
    refreshFilters();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (suggestions.hidden || !suggestionItems.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestionIndex = (suggestionIndex + 1) % suggestionItems.length;
      paintSuggestionState();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestionIndex = (suggestionIndex - 1 + suggestionItems.length) % suggestionItems.length;
      paintSuggestionState();
    } else if (e.key === 'Enter' && suggestionIndex >= 0) {
      e.preventDefault();
      chooseSuggestion(suggestionIndex);
    } else if (e.key === 'Escape') {
      hideSuggestions();
    }
  });

  suggestions.addEventListener('click', (e) => {
    const item = e.target.closest('li[data-product-id]');
    if (!item) return;
    chooseSuggestion(suggestionItems.findIndex((product) => product.id === item.dataset.productId));
  });

  document.addEventListener('click', (e) => {
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

    if (e.target.closest('#clear-filters-btn') || e.target.closest('#clear-sheet-filters-btn')) {
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
    { path: '/login', view: loginView, title: 'Ingresar · UP' },
    { path: '/registro', view: registerView, title: 'Crear cuenta · UP' },
    { path: '/cuenta', view: accountView, title: 'Mi cuenta · UP' },
    { path: '/cuenta/pedidos', view: ordersView, title: 'Mis pedidos · UP' },
    {
      path: '/cuenta/pedidos/:id',
      view: orderDetailView,
      title: (params) => `Pedido ${params.id} · UP`,
    },
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
    { path: '*', view: notFoundView, title: 'Página no encontrada · UP' },
  ];

  const router = createRouter({
    routes,
    getSession: () => sessionUser(loadState()),
    onBefore: () => {
      closePopovers();
      hideSuggestions();
      closeFilterSheet();
      closeCompareModal();
      closeCartDrawer();
    },
    onAfter: ({ path }) => {
      if (path === '/') syncFilterInputs();
      updateAuthLinks();
    },
  });

  updateAuthLinks();
  router.start();

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
      return;
    }
    trapDialogTab(e);
  });
});
