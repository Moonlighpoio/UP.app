/** Ofertas y eventos de ejemplo (FASE C). No alteran catálogo ni carrito. */
import { esc } from '../utils.js';
import { DEMO_PROMOS } from '../demo-content.js';
import { demoBadge, sourceNote } from './shared.js';

const TYPE_LABELS = { oferta: 'Oferta', evento: 'Evento' };
const INTRO =
  'Contenido ilustrativo para mostrar cómo UP presentaría campañas con su fuente. Nada de lo que ves aquí es una oferta real ni modifica precios, carritos ni pagos.';

function promoCard(item) {
  return `
    <article class="up-info-card">
      <div class="up-info-card-head">
        <span class="up-info-card-type">${esc(TYPE_LABELS[item.type] || 'Contenido')}</span>
        ${demoBadge(item.isDemo)}
      </div>
      <h2>${esc(item.title)}</h2>
      <p class="up-info-card-meta">${esc(item.chain)} · ${esc(item.period)}</p>
      <p>${esc(item.summary)}</p>
      ${sourceNote(item)}
    </article>`;
}

function body() {
  const ofertas = DEMO_PROMOS.filter((item) => item.type === 'oferta');
  const eventos = DEMO_PROMOS.filter((item) => item.type === 'evento');
  return `
    <aside class="up-test-notice">
      <strong>MODO PRUEBA</strong>
      <p>Todos los textos, cadenas y fechas son ficticios y están marcados como «Ejemplo».</p>
    </aside>
    <h2 class="up-content-subtitle">Ofertas de ejemplo</h2>
    <div class="up-content-grid">${ofertas.map(promoCard).join('')}</div>
    <h2 class="up-content-subtitle">Eventos de ejemplo</h2>
    <div class="up-content-grid">${eventos.map(promoCard).join('')}</div>
    <p class="up-content-back"><a href="#/">Volver al catálogo →</a></p>`;
}

export const offersView = {
  element: 'view-dynamic',
  render(container) {
    // El shell inicial de index.html se preserva para mejorar el LCP móvil.
    const slot = container.querySelector('#seal-ofertas [data-seal-slot]');
    if (slot) {
      slot.innerHTML = body();
      slot.removeAttribute('data-seal-slot');
      return;
    }
    container.innerHTML = `
      <section class="up-view-section up-container">
        <div class="up-section-head">
          <span class="up-eyebrow">OFERTAS Y EVENTOS · EJEMPLO</span>
          <h1 data-view-title tabindex="-1">Ofertas y eventos</h1>
          <p>${INTRO}</p>
        </div>
        ${body()}
      </section>`;
  },
  destroy() {},
};
