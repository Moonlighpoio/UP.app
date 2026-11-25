/**
 * UP · Estados uniformes de carga, vacío y error (FASE U7).
 * Funciones puras: devuelven HTML con el mismo lenguaje visual en todas las vistas.
 * Nunca inventan datos ni esconden contenido real detrás de un placeholder.
 */
import { esc } from './utils.js';

export function skeletonCards(count = 6) {
  return `<div class="up-skeleton-grid" aria-hidden="true">
    ${Array.from(
      { length: Math.max(1, Math.min(count, 12)) },
      () => `
      <article class="up-skeleton-card">
        <div class="up-skeleton up-skeleton-media"></div>
        <div class="up-skeleton up-skeleton-line"></div>
        <div class="up-skeleton up-skeleton-line up-skeleton-line-short"></div>
        <div class="up-skeleton up-skeleton-line up-skeleton-line-price"></div>
      </article>`
    ).join('')}
  </div>`;
}

export function loadingMarkup({ label = 'Cargando contenido de demostración…', cards = 6 } = {}) {
  return `<div class="up-state up-state-loading" role="status" aria-live="polite" aria-busy="true">
    <p class="up-state-label">${esc(label)}</p>
    ${skeletonCards(cards)}
  </div>`;
}

export function emptyMarkup({
  title = 'No hay resultados',
  message = '',
  actionHref = '',
  actionLabel = 'Ver productos',
} = {}) {
  return `<div class="up-state up-state-empty" role="status" aria-live="polite">
    <span class="up-state-icon" aria-hidden="true">◇</span>
    <h2>${esc(title)}</h2>
    ${message ? `<p>${esc(message)}</p>` : ''}
    ${actionHref ? `<a class="up-btn-secondary" href="${esc(actionHref)}">${esc(actionLabel)}</a>` : ''}
  </div>`;
}

export function errorMarkup({
  id = 'up-retry',
  title = 'No se pudo cargar esta sección',
  message = 'Revisa tu conexión e inténtalo de nuevo. Los datos guardados en este navegador siguen ahí.',
  retryLabel = 'Reintentar',
} = {}) {
  return `<div class="up-state up-state-error" role="alert" aria-live="assertive">
    <span class="up-state-icon" aria-hidden="true">!</span>
    <h2>${esc(title)}</h2>
    <p>${esc(message)}</p>
    <button type="button" id="${esc(id)}" data-retry class="up-btn-primary">${esc(retryLabel)}</button>
  </div>`;
}
