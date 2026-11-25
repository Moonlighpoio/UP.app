/** Beneficios bancarios de ejemplo (FASE C). Sin datos de tarjeta. */
import { esc } from '../utils.js';
import { loadState, updateState } from '../storage.js';
import { DEMO_BANK_BENEFITS } from '../demo-content.js';
import { showToast } from '../ui.js';
import { demoBadge, sourceNote } from './shared.js';

const INTRO =
  'Información ficticia para demostrar cómo UP mostraría beneficios verificados. UP nunca pide número de tarjeta, fecha de vencimiento ni CVV.';

function benefitCard(item, saved) {
  return `
    <article class="up-info-card" data-benefit-card="${esc(item.id)}">
      <div class="up-info-card-head">
        <span class="up-info-card-type">${esc(item.bank)}</span>
        ${demoBadge(item.isDemo)}
      </div>
      <h2>${esc(item.title)}</h2>
      <p>${esc(item.summary)}</p>
      <p class="up-info-card-meta">${esc(item.conditions)}</p>
      ${sourceNote(item)}
      <button
        type="button"
        class="up-btn-secondary"
        data-benefit-favorite="${esc(item.id)}"
        aria-pressed="${saved ? 'true' : 'false'}"
      >
        ${saved ? 'Quitar de favoritos' : 'Guardar como favorito'}
      </button>
    </article>`;
}

function body(favorites) {
  return `
    <aside class="up-test-notice">
      <strong>MODO PRUEBA</strong>
      <p>Sin conexión con bancos ni procesadores de pago. Guardar favoritos sólo escribe en este navegador.</p>
    </aside>
    <div class="up-content-grid">
      ${DEMO_BANK_BENEFITS.map((item) => benefitCard(item, favorites.includes(item.id))).join('')}
    </div>
    <p class="up-content-back">
      <a href="#/cuenta/beneficios">Ver mis favoritos</a> · <a href="#/">Volver al catálogo</a>
    </p>`;
}

function bindFavorites(container) {
  container.querySelectorAll('[data-benefit-favorite]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.benefitFavorite;
      const saved = loadState().favoriteBenefits.includes(id);
      updateState((state) => {
        state.favoriteBenefits = saved
          ? state.favoriteBenefits.filter((item) => item !== id)
          : [...state.favoriteBenefits, id];
      });
      button.setAttribute('aria-pressed', saved ? 'false' : 'true');
      button.textContent = saved ? 'Guardar como favorito' : 'Quitar de favoritos';
      showToast(saved ? 'Beneficio quitado de favoritos' : 'Beneficio guardado en este navegador');
    });
  });
}

export const bankBenefitsView = {
  element: 'view-dynamic',
  render(container) {
    const favorites = loadState().favoriteBenefits;
    // El shell inicial de index.html se preserva para mejorar el LCP móvil.
    const slot = container.querySelector('#seal-tarjetas [data-seal-slot]');
    if (slot) {
      slot.innerHTML = body(favorites);
      slot.removeAttribute('data-seal-slot');
    } else {
      container.innerHTML = `
        <section class="up-view-section up-container">
          <div class="up-section-head">
            <span class="up-eyebrow">BENEFICIOS BANCARIOS · EJEMPLO</span>
            <h1 data-view-title tabindex="-1">Beneficios bancarios</h1>
            <p>${INTRO}</p>
          </div>
          ${body(favorites)}
        </section>`;
    }
    bindFavorites(container);
  },
  destroy() {},
};
