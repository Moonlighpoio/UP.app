/**
 * UP · Modal comparador: 5 supermercados ordenados por precio.
 */
import { $, esc, formatCLP, getProductSVG, safeAssetUrl } from './utils.js';
import { getProduct, setActiveProduct, addReindex } from './state.js';
import { getProductStats, unitPriceFor } from './catalog.js';
import { linkMarkup } from './ui.js';
import { offerLink, verifyLink } from './links.js';
import { addToCart } from './cart.js';

const hooks = { notify: () => {} };

export function initCompare(nextHooks = {}) {
  hooks.notify = nextHooks.notify || hooks.notify;
}

export function openCompareModal(productId) {
  const product = getProduct(productId);
  if (!product) return;
  setActiveProduct(productId);
  const stats = getProductStats(product);
  const image = safeAssetUrl(product.image);

  $('modal-product-index').textContent = `(${product.index})`;
  $('modal-product-category').textContent = product.category;
  $('modal-product-art').innerHTML = image
    ? `<img src="${esc(image)}" alt="${esc(product.name)}" class="max-h-full max-w-full object-contain" />`
    : getProductSVG(product.icon);
  $('modal-product-name').textContent = product.name;
  $('modal-product-desc').textContent =
    `${product.unit} — Comparativa ordenada de menor a mayor precio en 5 supermercados de Chile.`;
  $('modal-best-price-badge').textContent =
    `MEJOR PRECIO: ${formatCLP(stats.minPrice)} (${stats.bestStore ? stats.bestStore.short : '—'})`;
  $('modal-savings-badge').textContent = `AHORRO MÁXIMO: ${formatCLP(stats.maxSavings)}`;

  const listEl = $('modal-stores-list');
  listEl.innerHTML = stats.sorted
    .map((entry, idx) => {
      const isBest = idx === 0;
      const diff = entry.price - stats.minPrice;
      const linkInfo = linkMarkup(product, entry.storeId);
      const unit = unitPriceFor(product, entry.price);

      return `
      <div class="p-3.5 sm:p-4 rounded-[6px] ${isBest ? 'bg-stage border border-signal/80' : 'utility-surface'} flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-start sm:items-center gap-3">
          <div class="w-8 h-8 rounded-[4px] ${isBest ? 'bg-signal text-ink' : 'bg-utility text-muted'} flex items-center justify-center font-dot text-[14px] shrink-0">#${idx + 1}</div>
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-mono text-[13px] font-semibold uppercase text-white">${esc(entry.store.name)}</span>
              ${isBest ? '<span class="px-1.5 py-0.5 rounded-[3px] bg-signal text-ink font-mono text-[9px] font-semibold uppercase">MEJOR PRECIO</span>' : `<span class="font-mono text-[10px] text-muted">+${formatCLP(diff)}</span>`}
            </div>
            ${linkInfo.html}
            ${
              unit
                ? `<span class="block font-mono text-[9px] uppercase text-muted mt-0.5">${formatCLP(unit.value)} ${esc(unit.label)}</span>`
                : ''
            }
          </div>
        </div>
        <div class="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-rule/40">
          <span class="font-dot text-[22px] ${isBest ? 'text-signal' : 'text-white'}">${formatCLP(entry.price)}</span>
          <div class="flex items-center gap-1.5">
            <select aria-label="Cantidad" id="qty-${esc(product.id)}-${entry.storeId}" class="h-[36px] px-2 bg-stage text-white font-mono text-[11px] rounded-[4px] tech-border focus:outline-none focus:border-signal">
              <option value="1">1 u</option><option value="2">2 u</option><option value="3">3 u</option><option value="6">6 u</option>
            </select>
            <button type="button" data-add-product="${esc(product.id)}" data-add-store="${entry.storeId}" ${linkInfo.broken ? 'disabled' : ''} class="add-to-cart-btn h-[36px] px-3 rounded-[4px] font-mono text-[11px] font-semibold uppercase transition-colors ${isBest ? 'bg-signal text-ink hover:bg-white' : 'bg-white text-ink hover:bg-signal'} ${linkInfo.broken ? 'opacity-40' : ''}">
              AGREGAR A UP
            </button>
          </div>
        </div>
      </div>`;
    })
    .join('');

  listEl.querySelectorAll('.add-to-cart-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pId = btn.dataset.addProduct;
      const sId = btn.dataset.addStore;
      const qty = parseInt($(`qty-${pId}-${sId}`).value, 10) || 1;
      addToCart(pId, sId, qty);
    });
  });

  listEl.querySelectorAll('[data-verify]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const chainId = btn.dataset.chain;
      if (!chainId) return;
      const product2 = getProduct(productId);
      const link = offerLink(product2, chainId);
      if (link.url) {
        verifyLink(link.url, productId, chainId, false, {
          onUpdate: () => openCompareModal(productId),
          notify: hooks.notify,
        });
      }
    });
  });

  listEl.querySelectorAll('[data-reindex]').forEach((btn) => {
    btn.addEventListener('click', () => {
      addReindex(btn.dataset.reindex);
      hooks.notify('PRODUCTO EN COLA DE RE-INDEXACIÓN');
      openCompareModal(productId);
    });
  });

  $('compare-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

export function closeCompareModal() {
  $('compare-modal').classList.add('hidden');
  document.body.style.overflow = '';
  setActiveProduct(null);
}
