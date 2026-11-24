/**
 * UP · Punto de entrada del front-end.
 * Solo cablea módulos y eventos: la lógica vive en src/*.js.
 */
import { $ } from './utils.js';
import { state } from './state.js';
import { applyDemoData } from './catalog.js';
import { refreshPrices } from './api.js';
import { initCart } from './cart.js';
import { initCompare, openCompareModal, closeCompareModal } from './compare.js';
import { finishCheckout, processUnifiedCheckout } from './checkout.js';
import {
  showToast,
  renderCategories,
  renderProducts,
  renderCartUI,
  initUI,
  openCartDrawer,
  closeCartDrawer,
  closeCheckoutModal
} from './ui.js';

function renderAll() {
  renderCategories();
  renderProducts();
  renderCartUI();
}

function refreshActiveModal() {
  if (state.activeProductId && !$('compare-modal').classList.contains('hidden')) {
    openCompareModal(state.activeProductId);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initCart({ notify: showToast, render: renderCartUI });
  initUI({ onOpenCompare: openCompareModal });
  initCompare({ notify: showToast });

  const priceHooks = { notify: showToast, renderAll, refreshActiveModal };

  const demo = window.UP_DEMO_DATA;
  if (demo) applyDemoData(demo);

  renderAll();
  refreshPrices(true, priceHooks);

  const searchInput = $('main-search-input');
  const clearSearchBtn = $('clear-search-btn');

  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    clearSearchBtn.classList.toggle('hidden', !state.searchQuery);
    renderProducts();
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    clearSearchBtn.classList.add('hidden');
    renderProducts();
  });

  $('nav-search-btn').addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => searchInput.focus(), 300);
  });

  $('sort-select').addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    renderProducts();
  });

  $('reset-filters-btn').addEventListener('click', () => {
    state.selectedCategory = 'TODOS';
    state.searchQuery = '';
    searchInput.value = '';
    clearSearchBtn.classList.add('hidden');
    renderCategories();
    renderProducts();
  });

  $('refresh-prices-btn').addEventListener('click', () => refreshPrices(false, priceHooks));

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

  $('checkout-btn').addEventListener('click', processUnifiedCheckout);
  $('close-checkout-modal').addEventListener('click', closeCheckoutModal);
  $('finish-order-btn').addEventListener('click', finishCheckout);

  document.querySelectorAll('.accordion-trigger').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const content = trigger.nextElementSibling;
      const icon = trigger.querySelector('.accordion-icon');
      const isOpen = !content.classList.contains('hidden');
      document.querySelectorAll('.accordion-content').forEach((c) => c.classList.add('hidden'));
      document.querySelectorAll('.accordion-icon').forEach((i) => { i.textContent = '+'; });
      if (!isOpen) {
        content.classList.remove('hidden');
        icon.textContent = '−';
      }
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCompareModal();
      closeCartDrawer();
      closeCheckoutModal();
    }
  });
});
