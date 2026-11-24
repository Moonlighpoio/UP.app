/**
 * UP · Render, toasts y avisos descartables.
 * Toda la manipulación del DOM de la demo vive aquí.
 */
import { $, esc, formatCLP, norm, getProductSVG, safeAssetUrl } from './utils.js';
import { STATIC_DEMO } from './config.js';
import { state, getLinkVerification, hasReindex } from './state.js';
import { getProductStats } from './catalog.js';
import { offerLink, reindexKey } from './links.js';
import { calculateCartTotals, updateCartQty, removeFromCart } from './cart.js';

const uiHooks = { onOpenCompare: () => {} };
let toastTimer;

export function initUI(nextHooks = {}) {
  uiHooks.onOpenCompare = nextHooks.onOpenCompare || uiHooks.onOpenCompare;
}

export function showToast(msg) {
  const toast = $('toast');
  $('toast-message').textContent = msg;
  toast.classList.remove('translate-x-[140%]');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('translate-x-[140%]'), 2800);
}

export function renderCategories() {
  const container = $('category-filters');
  container.innerHTML = state.categories
    .map((cat) => {
      const active = state.selectedCategory === cat;
      return `
      <button type="button" data-category="${esc(cat)}" class="cat-btn h-[40px] px-4 rounded-[4px] font-mono text-[12px] uppercase transition-all ${
        active
          ? 'bg-signal text-ink font-semibold'
          : 'utility-surface text-soft hover:text-white hover:border-white/40'
      }">${esc(cat)}</button>`;
    })
    .join('');

  container.querySelectorAll('.cat-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedCategory = btn.dataset.category;
      renderCategories();
      renderProducts();
    });
  });
}

export function renderProducts() {
  const grid = $('product-grid');
  const emptyState = $('empty-state');
  const countEl = $('results-count');

  const filtered = state.products.filter((p) => {
    const matchCat = state.selectedCategory === 'TODOS' || p.category === state.selectedCategory;
    const q = norm(state.searchQuery.trim());
    const hay = norm(p.name + ' ' + p.category + ' ' + p.unit + ' ' + p.description);
    return matchCat && (!q || q.split(/\s+/).every((token) => hay.includes(token)));
  });

  if (state.sortBy === 'price-asc')
    filtered.sort((a, b) => getProductStats(a).minPrice - getProductStats(b).minPrice);
  else if (state.sortBy === 'price-desc')
    filtered.sort((a, b) => getProductStats(b).minPrice - getProductStats(a).minPrice);
  else if (state.sortBy === 'savings-desc')
    filtered.sort((a, b) => getProductStats(b).maxSavings - getProductStats(a).maxSavings);

  countEl.textContent = `${filtered.length} PRODUCTO${filtered.length === 1 ? '' : 'S'}`;

  if (!filtered.length) {
    grid.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  grid.innerHTML = filtered
    .map((product) => {
      const stats = getProductStats(product);
      const image = safeAssetUrl(product.image);
      return `
      <article data-product-id="${esc(product.id)}" class="product-card group cursor-pointer bg-[#141414] tech-border rounded-[8px] overflow-hidden flex flex-col transition-all duration-200">
        <div class="relative bg-stage h-[176px] flex items-center justify-center p-6 tech-border-b overflow-hidden">
          <div class="product-stage-glow absolute inset-0 opacity-0 transition-opacity duration-300 pointer-events-none" style="background: radial-gradient(circle at center, rgba(255,199,0,0.12) 0%, rgba(0,0,0,0) 70%);"></div>
          <span class="absolute top-3 left-3 font-dot text-[14px] text-muted group-hover:text-signal transition-colors">(${esc(product.index)})</span>
          <span class="absolute top-3 right-3 font-mono text-[10px] uppercase text-muted px-2 py-0.5 rounded-[4px] bg-utility">${esc(product.category)}</span>
          <div class="transform group-hover:scale-105 transition-transform duration-300 flex items-center justify-center h-full">
            ${
              image
                ? `<img src="${esc(image)}" alt="${esc(product.name)}" loading="lazy" class="max-h-full max-w-full object-contain" />`
                : getProductSVG(product.icon)
            }
          </div>
        </div>
        <div class="p-4 flex-1 flex flex-col justify-between gap-4">
          <div>
            <h3 class="font-serif text-[20px] leading-[1.15] text-white group-hover:text-signal transition-colors">${esc(product.name)}</h3>
            <p class="font-mono text-[11px] uppercase text-muted mt-1.5">${esc(product.unit)} · 5 SUPERMERCADOS</p>
          </div>
          <div class="pt-3 tech-border-t flex items-end justify-between gap-2">
            <div>
              <span class="block font-mono text-[10px] uppercase text-muted">DESDE (${stats.bestStore ? esc(stats.bestStore.short) : '—'})</span>
              <span class="font-dot text-[22px] text-signal leading-none">${formatCLP(stats.minPrice)}</span>
            </div>
            <span class="inline-flex items-center gap-1 font-mono text-[11px] uppercase text-white group-hover:text-signal transition-colors underline underline-offset-4">COMPARAR →</span>
          </div>
        </div>
      </article>`;
    })
    .join('');

  grid.querySelectorAll('.product-card').forEach((card) => {
    card.addEventListener('click', () => uiHooks.onOpenCompare(card.dataset.productId));
  });
}

export function linkMarkup(product, chainId) {
  const link = offerLink(product, chainId);
  const v = link.canonical && link.url ? getLinkVerification(link.url) : null;
  const broken = !!(v && !v.loading && !v.ok);
  const verified = !!(v && !v.loading && v.ok);
  const pending = hasReindex(reindexKey(product.id, chainId));

  let stateText = 'Sin SKU mapeado';
  let stateAttr = 'none';
  let action = pending ? 'data-reindex' : '';
  if (STATIC_DEMO && link.canonical && link.url) {
    stateText = 'Demo · sin verificación';
    stateAttr = 'demo';
    action = '';
  } else if (broken) {
    stateText = '⚠ Enlace roto · reindexar';
    stateAttr = 'broken';
    action = 'data-reindex';
  } else if (verified) {
    stateText = 'Verificado ✓';
    stateAttr = 'ok';
    action = '';
  } else if (v && v.loading) {
    stateText = 'Verificando…';
    stateAttr = 'loading';
    action = '';
  } else if (link.canonical && link.url) {
    stateText = 'Verificar';
    stateAttr = 'verify';
    action = 'data-verify';
  } else if (!link.url && link.token) {
    stateText = 'Búsqueda SKU exacta';
    stateAttr = 'search';
    action = '';
  } else if (pending) {
    stateText = 'En cola de re-indexación';
    stateAttr = 'search';
    action = 'data-reindex';
  }

  return {
    broken,
    html: `
      ${
        link.url
          ? `<a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 mt-1 font-mono text-[11px] uppercase text-soft hover:text-signal underline underline-offset-4 transition-colors"><span>VER EN TIENDA</span><span>↗</span></a>
      <span class="block font-mono text-[9px] uppercase text-muted mt-0.5">${link.kind === 'ficha' ? 'FICHA' : 'SKU/GTIN'} ${esc(link.token || '—')}</span>`
          : ''
      }
      <button type="button" class="verify-badge mt-1 px-1.5 py-0.5 rounded-[3px] utility-surface font-mono text-[9px] uppercase" data-state="${stateAttr}" data-chain="${esc(chainId)}" ${action ? `${action}="${esc(action === 'data-reindex' ? reindexKey(product.id, chainId) : link.url)}"` : ''}>${stateText}</button>
      ${broken ? '<span class="block font-mono text-[9px] uppercase text-signal mt-1">PRECIO NO CONFIRMADO</span>' : ''}`,
  };
}

export function renderCartUI() {
  const { storeGroups, totalItems, productsSubtotal, totalShipping, upFee, grandTotal } =
    calculateCartTotals();

  $('nav-cart-count').textContent = totalItems;

  const dock = $('bottom-dock');
  if (totalItems > 0) {
    dock.classList.remove('hidden');
    $('dock-summary').textContent =
      `${totalItems} PROD · ${storeGroups.length} SUPERMERCADO${storeGroups.length > 1 ? 'S' : ''}`;
    $('dock-total').textContent = formatCLP(grandTotal);
  } else {
    dock.classList.add('hidden');
  }

  const container = $('cart-items-container');
  const checkoutBtn = $('checkout-btn');

  if (!storeGroups.length) {
    container.innerHTML = `
      <div class="h-full flex flex-col items-center justify-center text-center py-16 px-4">
        <p class="font-dot text-[20px] uppercase text-white">TU CARRITO UP ESTÁ VACÍO</p>
        <p class="font-sans text-[13px] text-muted mt-2">Selecciona productos del catálogo para armar tus sub-carritos por supermercado.</p>
      </div>`;
    checkoutBtn.disabled = true;
  } else {
    checkoutBtn.disabled = false;
    container.innerHTML = storeGroups
      .map(
        (group) => `
      <div class="rounded-[8px] bg-[#141414] tech-border overflow-hidden">
        <div class="bg-stage px-4 py-3 tech-border-b flex items-center justify-between">
          <span class="font-mono text-[12px] font-semibold uppercase text-white">CARRITO ${esc(group.store.short)}</span>
          <span class="font-dot text-[16px] text-signal">${formatCLP(group.subtotal)}</span>
        </div>
        <div class="px-4 py-2.5 bg-utility/60 tech-border-b">
          <div class="flex items-center justify-between text-[10px] font-mono uppercase mb-1.5">
            ${
              group.isFreeShipping
                ? '<span class="text-signal font-semibold">✓ DESPACHO GRATIS DESBLOQUEADO</span>'
                : `<span class="text-soft">AGREGA <strong class="text-white">${formatCLP(group.missingForFree)}</strong> EN ${esc(group.store.short)} PARA DESPACHO GRATIS</span>`
            }
            <span class="text-muted">${group.progressPct}%</span>
          </div>
          <div class="w-full h-1.5 bg-stage rounded-[8px] overflow-hidden">
            <div class="h-full ${group.isFreeShipping ? 'bg-signal' : 'bg-white'} transition-all duration-300" style="width: ${group.progressPct}%"></div>
          </div>
        </div>
        <div class="divide-y divide-rule/40">
          ${group.items
            .map(
              (item) => `
            <div class="p-3.5 flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="font-sans text-[13px] text-white truncate">${esc(item.product.name)}</p>
                <p class="font-mono text-[11px] text-muted mt-0.5">${formatCLP(item.unitPrice)} c/u</p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <div class="flex items-center bg-stage tech-border rounded-[4px]">
                  <button type="button" data-qty-key="${esc(item.key)}" data-delta="-1" class="cart-qty-btn w-7 h-7 flex items-center justify-center font-mono text-[13px] text-soft hover:text-signal">−</button>
                  <span class="w-6 text-center font-mono text-[11px] text-white">${item.qty}</span>
                  <button type="button" data-qty-key="${esc(item.key)}" data-delta="1" class="cart-qty-btn w-7 h-7 flex items-center justify-center font-mono text-[13px] text-soft hover:text-signal">+</button>
                </div>
                <button type="button" data-remove-key="${esc(item.key)}" class="cart-remove-btn text-muted hover:text-signal font-mono text-[11px] px-1" title="Eliminar">✕</button>
              </div>
            </div>`
            )
            .join('')}
        </div>
        <div class="px-4 py-2 bg-stage/60 flex items-center justify-between font-mono text-[10px] uppercase text-muted">
          <span>DESPACHO ${esc(group.store.short)}</span>
          <span class="${group.isFreeShipping ? 'text-signal' : 'text-soft'}">${group.isFreeShipping ? 'GRATIS' : formatCLP(group.shipping)}</span>
        </div>
      </div>`
      )
      .join('');

    container.querySelectorAll('.cart-qty-btn').forEach((btn) => {
      btn.addEventListener('click', () =>
        updateCartQty(btn.dataset.qtyKey, parseInt(btn.dataset.delta, 10))
      );
    });
    container.querySelectorAll('.cart-remove-btn').forEach((btn) => {
      btn.addEventListener('click', () => removeFromCart(btn.dataset.removeKey));
    });
  }

  $('summary-subtotal').textContent = formatCLP(productsSubtotal);
  $('summary-shipping').textContent =
    totalShipping === 0 && totalItems > 0 ? 'GRATIS' : formatCLP(totalShipping);
  $('summary-fee').textContent = formatCLP(upFee);
  $('summary-total').textContent = formatCLP(grandTotal);
}

export function openCartDrawer() {
  $('cart-drawer-backdrop').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

export function closeCartDrawer() {
  $('cart-drawer-backdrop').classList.add('hidden');
  document.body.style.overflow = '';
}

export function closeCheckoutModal() {
  $('checkout-modal').classList.add('hidden');
  document.body.style.overflow = '';
}
