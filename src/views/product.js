/** Ficha de producto (#/producto/:id), con descripción propia y precios por cadena. */
import { esc, formatCLP, getProductSVG, safeAssetUrl, safeHttpUrl } from '../utils.js';
import { getProduct, state } from '../state.js';
import {
  effectiveSku,
  getConfirmedProductStats,
  getProductStats,
  unitPriceFor,
} from '../catalog.js';
import { freshnessFor, verifiedPriceLabel } from '../freshness.js';
import { freshnessBadge } from '../ui.js';
import { loadState } from '../storage.js';
import { openReportDialog } from '../report-ui.js';
import { priceForDisplay } from '../filters.js';
import { offerLink } from '../links.js';
import { STATIC_DEMO } from '../config.js';
import { addToCart } from '../cart.js';
import { showToast } from '../ui.js';

let addedTimer = null;

function relatedMarkup(product) {
  const related = state.products
    .filter((item) => item.category === product.category && item.id !== product.id)
    .slice(0, 4);
  if (!related.length) return '<p>No hay otros productos de esta categoría.</p>';
  return `<ul class="up-related-grid">${related
    .map((item) => {
      const shown = priceForDisplay(item);
      const image = safeAssetUrl(item.image);
      return `
      <li>
        <a href="#/producto/${encodeURIComponent(item.id)}" class="up-related-card">
          <span class="up-related-media">
            ${image ? `<img src="${esc(image)}" alt="" width="120" height="120" loading="lazy" decoding="async" />` : getProductSVG(item.icon)}
          </span>
          <strong>${esc(item.name)}</strong>
          <span class="price">${formatCLP(shown.price)}</span>
        </a>
      </li>`;
    })
    .join('')}</ul>`;
}

function priceRows(product) {
  const rows = getProductStats(product).sorted;
  const overrides = loadState().overrides;
  if (!rows.length) return '<tr><td colspan="4">No hay precios disponibles.</td></tr>';
  return rows
    .map((entry) => {
      const sku = effectiveSku(product, entry.storeId, overrides);
      const confirmed = sku.status === 'verified' && !STATIC_DEMO;
      const fresh = freshnessFor(sku);
      const verifiedLabel = verifiedPriceLabel(sku);
      return `
      <tr>
        <th scope="row">${esc(entry.store.name)}</th>
        <td>${confirmed ? `<strong class="price">${formatCLP(entry.price)}</strong>` : '<span class="up-unconfirmed">Sin confirmar</span>'}</td>
        <td>
          ${
            confirmed && safeHttpUrl(offerLink(product, entry.storeId).url)
              ? `<a href="${esc(safeHttpUrl(offerLink(product, entry.storeId).url))}" target="_blank" rel="noopener noreferrer">Ver en tienda ↗</a>`
              : '<span class="up-text-muted">Sin enlace verificado</span>'
          }
        </td>
        <td>
          ${fresh.stale ? '<span class="up-fresh up-fresh--warning">Precio desactualizado</span>' : `<span class="up-fresh up-fresh--${confirmed ? 'ok' : 'neutral'}">${esc(confirmed ? fresh.label : 'Sin confirmar')}</span>`}
          ${verifiedLabel ? `<span class="up-verified-label">${esc(verifiedLabel)}</span>` : ''}
        </td>
      </tr>`;
    })
    .join('');
}

export const productView = {
  element: 'view-dynamic',
  render(container, { params }) {
    const product = getProduct(params.id);
    if (!product) {
      container.innerHTML = `
        <section class="up-view-section up-container">
          <nav class="up-breadcrumb" aria-label="Ruta de navegación"><a href="#/">Inicio</a><span aria-hidden="true">›</span><span>Producto no encontrado</span></nav>
          <h1 data-view-title tabindex="-1">No encontramos ese producto</h1>
          <p>Puede que el enlace esté desactualizado.</p>
          <p><a class="up-btn-primary" href="#/">Volver al inicio</a></p>
        </section>`;
      return;
    }

    const shown = priceForDisplay(product);
    const overrides = loadState().overrides;
    const confirmedStats = getConfirmedProductStats(product, { overrides });
    const confirmedBest = shown.best && confirmedStats.minPrice === shown.price;
    const shownSku = effectiveSku(product, shown.store?.id || '', overrides);
    const verifiedLabel = verifiedPriceLabel(shownSku);
    const unit = unitPriceFor(product, shown.price);
    const image = safeAssetUrl(product.image);
    const link = offerLink(product, shown.store?.id || '');
    const storeUrl = safeHttpUrl(link.url);
    const media = image
      ? `<img src="${esc(image)}" alt="${esc(product.name)}" width="480" height="480" decoding="async" />`
      : getProductSVG(product.icon);

    container.innerHTML = `
      <section class="up-view-section up-container up-detail">
        <nav class="up-breadcrumb" aria-label="Ruta de navegación">
          <a href="#/">Inicio</a>
          <span aria-hidden="true">›</span>
          <a href="#/">${esc(product.category)}</a>
          <span aria-hidden="true">›</span>
          <span aria-current="page">${esc(product.name)}</span>
        </nav>

        <div class="up-detail-grid">
          <div class="up-detail-gallery">
            <span class="up-eyebrow">GALERÍA · PANEL DE FOTO</span>
            <div class="up-detail-art">${media}</div>
            <p class="up-detail-art-note">Foto referencial del catálogo de demostración.</p>
          </div>

          <div class="up-detail-info">
            <span class="up-eyebrow">${esc(product.category)}</span>
            <h1 data-view-title tabindex="-1">${esc(product.name)}</h1>
            <dl class="up-detail-facts">
              <div><dt>Marca</dt><dd>${esc(product.name.split(' ').slice(0, 2).join(' '))}</dd></div>
              <div><dt>Formato</dt><dd>${esc(product.unit)}</dd></div>
              <div><dt>Categoría</dt><dd>${esc(product.category)}</dd></div>
            </dl>
            <p class="up-detail-description">${esc(product.description || 'Descripción de demostración pendiente.')}</p>
            <p class="up-detail-source">Origen: ${esc(product.descriptionSource || 'UP · texto propio (demo)')} · no reproduce fichas comerciales.</p>

            <div class="up-detail-price">
              <span class="up-eyebrow">${
                confirmedBest
                  ? 'MEJOR PRECIO'
                  : shown.best
                    ? 'MENOR PRECIO REFERENCIAL'
                    : 'PRECIO REFERENCIAL'
              }</span>
              <strong class="price">${formatCLP(shown.price)}</strong>
              <span>${shown.store ? esc(shown.store.name) : 'Sin tienda disponible'}</span>
              ${unit ? `<span class="up-detail-unit">${formatCLP(unit.value)} ${esc(unit.label)} · estimado</span>` : ''}
              <span class="up-detail-freshness">${freshnessBadge(product, shown.store?.id)}</span>
              ${verifiedLabel ? `<span class="up-verified-label">${esc(verifiedLabel)}</span>` : ''}
            </div>
            <p class="up-detail-report">
              <button type="button" class="up-link-btn" data-report-price>
                Reportar precio incorrecto
              </button>
              <a href="#/ayuda/datos">Cómo obtenemos los precios</a>
            </p>

            <div class="up-detail-buy">
              <div class="up-qty" role="group" aria-label="Cantidad de ${esc(product.name)}">
                <button type="button" data-detail-qty="-1" aria-label="Disminuir cantidad">−</button>
                <span data-detail-qty-value aria-live="polite">1</span>
                <button type="button" data-detail-qty="1" aria-label="Aumentar cantidad">+</button>
              </div>
              <button type="button" class="up-btn-primary up-detail-add" data-detail-add ${shown.store ? '' : 'disabled'}>
                Agregar al carrito
              </button>
              ${
                storeUrl
                  ? `<a class="up-btn-secondary" href="${esc(storeUrl)}" target="_blank" rel="noopener noreferrer">Ver en tienda ↗</a>`
                  : '<span class="up-text-muted">Sin enlace de tienda verificado</span>'
              }
            </div>
          </div>
        </div>

        <section class="up-detail-table" aria-labelledby="detail-prices-title">
          <h2 id="detail-prices-title">Precios por supermercado</h2>
          <div class="up-table-wrap">
            <table class="up-data-table">
              <caption>Sólo se muestra un precio confirmado cuando su fuente está verificada.</caption>
              <thead>
                <tr><th scope="col">Supermercado</th><th scope="col">Precio</th><th scope="col">Enlace</th><th scope="col">Frescura</th></tr>
              </thead>
              <tbody>${priceRows(product)}</tbody>
            </table>
          </div>
        </section>

        <section class="up-related" aria-labelledby="related-title">
          <h2 id="related-title">También te puede interesar</h2>
          ${relatedMarkup(product)}
        </section>
      </section>`;

    let qty = 1;
    container.onclick = (event) => {
      const deltaBtn = event.target.closest('[data-detail-qty]');
      if (deltaBtn) {
        qty = Math.max(1, Math.min(99, qty + Number(deltaBtn.dataset.detailQty)));
        container.querySelector('[data-detail-qty-value]').textContent = qty;
        return;
      }
      const reportBtn = event.target.closest('[data-report-price]');
      if (reportBtn) {
        openReportDialog(product.id, shown.store?.id || '');
        return;
      }
      const addBtn = event.target.closest('[data-detail-add]');
      if (!addBtn || !shown.store) return;
      addToCart(product.id, shown.store.id, qty);
      addBtn.textContent = 'Agregado ✓';
      addBtn.classList.add('up-added');
      clearTimeout(addedTimer);
      addedTimer = setTimeout(() => {
        addBtn.textContent = 'Agregar al carrito';
        addBtn.classList.remove('up-added');
      }, 1400);
      showToast(`${qty} ${product.name} agregado a tu carrito`);
    };
  },
  destroy() {
    clearTimeout(addedTimer);
  },
};
