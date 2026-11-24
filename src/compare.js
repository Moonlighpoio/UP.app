/**
 * UP · Modal comparador: 5 supermercados ordenados por precio.
 */
import { $, esc, formatCLP, getProductSVG, safeAssetUrl, safeHttpUrl } from './utils.js';
import { getProduct, setActiveProduct, addReindex } from './state.js';
import { getProductStats, unitPriceFor } from './catalog.js';
import { linkMarkup } from './ui.js';
import { offerLink, isPurchaseBlocked, verifyLink } from './links.js';
import { addToCart } from './cart.js';
import { openDialog, closeDialog } from './a11y.js';

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
    ? `<img src="${esc(image)}" alt="${esc(product.name)}" width="112" height="112" loading="lazy" decoding="async" />`
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
      const link = offerLink(product, entry.storeId);
      const blocked = isPurchaseBlocked(product, entry.storeId, linkInfo.broken);
      const pricing = (product.skus && product.skus[entry.storeId]) || {};
      const priceVerified = pricing.priceSource === 'pricto' && pricing.status === 'verified';
      const referential = !blocked && !link.canonical && !priceVerified;
      const retailerUrl = safeHttpUrl(pricing.priceRetailerUrl);
      const attribution = priceVerified
        ? `<span class="up-price-source"><span class="up-price-source-chip">✓ Precio verificado</span> ${esc(
            pricing.priceAttribution || ''
          )}${retailerUrl ? ` · <a href="${esc(retailerUrl)}" target="_blank" rel="noopener noreferrer">Ficha ↗</a>` : ''}</span>`
        : '';
      const unit = unitPriceFor(product, entry.price);

      return `
      <tr class="up-compare-row${isBest ? ' up-best' : ''}${blocked || referential ? ' up-unconfirmed' : ''}${referential ? ' up-referential' : ''}">
        <th scope="row">
          <span class="up-compare-store">
            <span class="up-rank" aria-hidden="true">${idx + 1}</span>
            <b>${esc(entry.store.name)}</b>
            ${
              isBest
                ? '<span class="up-chip up-chip--success">✓ Mejor precio</span>'
                : `<span class="up-diff">+${formatCLP(diff)}</span>`
            }
          </span>
          ${
            blocked
              ? '<span class="up-unconfirmed-label">Precio no confirmado</span>'
              : referential
                ? '<span class="up-referential-label">Precio referencial · búsqueda exacta por GTIN</span>'
                : ''
          }
          ${attribution}
          ${linkInfo.html}
        </th>
        <td><strong class="price up-compare-price">${formatCLP(entry.price)}</strong></td>
        <td>${unit ? `${formatCLP(unit.value)} ${esc(unit.label)}` : '—'}</td>
        <td>
          <span class="up-compare-buy">
            <label class="up-sr-only" for="qty-${esc(product.id)}-${entry.storeId}">Cantidad para ${esc(entry.store.name)}</label>
            <select id="qty-${esc(product.id)}-${entry.storeId}" aria-label="Cantidad para ${esc(entry.store.name)}">
              <option value="1">1 u</option><option value="2">2 u</option><option value="3">3 u</option><option value="6">6 u</option>
            </select>
            <button type="button" data-add-product="${esc(product.id)}" data-add-store="${entry.storeId}" ${blocked ? 'disabled' : ''} class="up-btn-primary up-compare-add add-to-cart-btn">
              Agregar
            </button>
          </span>
        </td>
      </tr>`;
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

  openDialog($('compare-modal'), 'close-compare-modal');
}

export function closeCompareModal() {
  closeDialog($('compare-modal'));
  setActiveProduct(null);
}
