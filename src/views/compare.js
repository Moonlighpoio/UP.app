/** #/comparar · hasta 3 productos lado a lado (FASE U4). */
import { esc, formatCLP, getProductSVG, safeAssetUrl } from '../utils.js';
import { getProduct } from '../state.js';
import { STORES } from '../config.js';
import { loadState } from '../storage.js';
import { getComparisonIds, removeFromComparisonId } from '../compare-picker.js';
import { comparisonMatrix, MAX_COMPARE_PRODUCTS } from '../compare-products.js';
import { demoBadge } from './shared.js';

function removeButton(id, name) {
  return `<button type="button" class="up-link-btn" data-compare-remove="${esc(id)}" aria-label="Quitar ${esc(name)} de la comparación">Quitar</button>`;
}

function render(container) {
  const ids = getComparisonIds();
  const products = ids.map((id) => getProduct(id)).filter(Boolean);
  const matrix = comparisonMatrix(products, { overrides: loadState().overrides });
  const chains = Object.keys(STORES);

  if (!matrix.length) {
    container.innerHTML = `
      <section class="up-view-section up-container">
        <span class="up-eyebrow">COMPARADOR</span>
        <h1 data-view-title tabindex="-1">Comparar productos</h1>
        <div class="up-empty-inline">
          <p>No hay productos seleccionados. Elige hasta ${MAX_COMPARE_PRODUCTS} productos con «Comparar hasta 3».</p>
          <a class="up-btn-primary" href="#catalogo">Ver productos</a>
        </div>
      </section>`;
    return;
  }

  container.innerHTML = `
    <section class="up-view-section up-container up-compare-products">
      <nav class="up-breadcrumb" aria-label="Ruta de navegación"><a href="#/">Inicio</a><span aria-hidden="true">›</span><span aria-current="page">Comparar productos</span></nav>
      <span class="up-eyebrow">COMPARADOR</span>
      <h1 data-view-title tabindex="-1">Comparar hasta ${MAX_COMPARE_PRODUCTS} productos</h1>
      <p class="up-view-lead">Precio por cadena, precio por unidad y formato. Los valores sin confirmar son referenciales y no constituyen una oferta.</p>
      <div class="up-table-wrap">
        <table class="up-data-table up-compare-matrix">
          <caption>Comparación local de ${matrix.length} productos. Los precios no verificados se muestran como referencia.</caption>
          <thead>
            <tr>
              <th scope="col">Producto</th>
              ${chains.map((id) => `<th scope="col">${esc(STORES[id].name)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${matrix
              .map(
                (row) => `<tr>
              <th scope="row">
                <span class="up-compare-product">
                  ${safeAssetUrl(row.image) ? `<img src="${esc(safeAssetUrl(row.image))}" alt="Imagen de ${esc(row.name)}" width="56" height="56" loading="lazy" decoding="async" />` : getProductSVG(row.icon)}
                  <span><strong>${esc(row.name)}</strong><small>${esc(row.category)} · ${esc(row.format)}</small>${removeButton(row.id, row.name)}</span>
                </span>
              </th>
              ${row.chains
                .map(
                  (cell) => `<td>
                <strong class="price">${cell.price == null ? '—' : formatCLP(cell.price)}</strong>
                <small>${cell.unitPrice == null ? '—' : `${formatCLP(cell.unitPrice)} ${esc(cell.unitLabel || '')}`}</small>
                <small class="${cell.confirmed ? 'up-compare-confirmed' : 'up-unconfirmed'}">${cell.confirmed ? 'Verificado' : 'Sin confirmar'}</small>
              </td>`
                )
                .join('')}
            </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <p class="up-text-muted">${demoBadge(true)} Los cálculos de $/unidad se estiman desde el formato declarado en el catálogo de demostración.</p>
      <p><a class="up-btn-primary" href="#catalogo">Seguir explorando</a></p>
    </section>`;

  container.querySelectorAll('[data-compare-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      removeFromComparisonId(button.dataset.compareRemove);
      render(container);
    });
  });
}

export const compareView = {
  element: 'view-dynamic',
  render,
  destroy() {},
};
