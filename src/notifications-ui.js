/**
 * UP · Centro de notificaciones internas (FASE U4). Sólo avisos locales,
 * nunca correos ni mensajes a servicios externos.
 */
import { $, esc } from './utils.js';
import { loadState, updateState } from './storage.js';
import { clearNotifications, markAllRead, unreadCount } from './alerts.js';

let bound = false;

function panel() {
  return $('notifications-panel');
}

function dateLabel(at) {
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? 'sin fecha'
    : date.toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
}

export function closeNotifications() {
  const el = panel();
  if (!el) return;
  el.hidden = true;
  $('notifications-btn')?.setAttribute('aria-expanded', 'false');
}

export function renderNotifications() {
  const button = $('notifications-btn');
  const countEl = $('notifications-count');
  const el = panel();
  if (!button || !el) return;
  const saved = loadState();
  const items = [...(saved.notifications || [])].reverse();
  const unread = unreadCount(saved);
  button.setAttribute('aria-label', `Notificaciones, ${unread} sin leer`);
  if (countEl) {
    countEl.textContent = String(unread);
    countEl.hidden = unread === 0;
  }
  el.innerHTML = `
    <div class="up-notifications-head">
      <h2 id="notifications-title">Notificaciones</h2>
      <button type="button" id="close-notifications" class="up-icon-btn" aria-label="Cerrar notificaciones">×</button>
    </div>
    <p class="up-text-muted">Avisos generados en este navegador. No se envían correos.</p>
    <div class="up-notifications-actions">
      <button type="button" id="notifications-read" class="up-btn-secondary"${unread ? '' : ' disabled'}>Marcar todas como leídas</button>
      <button type="button" id="notifications-clear" class="up-btn-secondary"${items.length ? '' : ' disabled'}>Borrar avisos</button>
    </div>
    <ul class="up-notifications-list">
      ${
        items.length
          ? items
              .map(
                (item) => `<li class="up-notification${item.read ? '' : ' is-unread'}">
          <p>${esc(item.message || 'Aviso de precio')}${item.isDemo ? ' <span class="up-demo-tag">Ejemplo</span>' : ''}</p>
          <small>${esc(dateLabel(item.at))}${item.price ? ` · ${esc(String(item.chain || ''))}` : ''}</small>
        </li>`
              )
              .join('')
          : '<li class="up-empty-inline">Aún no hay avisos. Crea una alerta en el detalle de un producto.</li>'
      }
    </ul>`;
  $('close-notifications')?.addEventListener('click', closeNotifications);
  $('notifications-read')?.addEventListener('click', () => {
    updateState(markAllRead);
    renderNotifications();
  });
  $('notifications-clear')?.addEventListener('click', () => {
    updateState(clearNotifications);
    renderNotifications();
  });
}

export function initNotificationsUI() {
  if (bound) return;
  bound = true;
  $('notifications-btn')?.addEventListener('click', () => {
    const el = panel();
    if (!el) return;
    el.hidden = !el.hidden;
    $('notifications-btn').setAttribute('aria-expanded', String(!el.hidden));
    if (!el.hidden) renderNotifications();
  });
  document.addEventListener('click', (event) => {
    if (!panel() || panel().hidden) return;
    if (!event.target.closest('#notifications-btn, #notifications-panel')) closeNotifications();
  });
  renderNotifications();
}
