/** Utilidades compartidas por las vistas de FASE A (sólo presentación). */
import { esc, formatCLP } from '../utils.js';
import { loadState } from '../storage.js';
import { sessionUser } from '../auth.js';

export const STATUS_LABELS = {
  recibido: 'Recibido',
  preparando: 'Preparando',
  'en camino': 'En camino',
  entregado: 'Entregado',
  'listo para retiro': 'Listo para retiro',
  pendiente: 'Pendiente',
};

export function statusBadge(status) {
  const key = String(status || 'pendiente').toLowerCase();
  const label = STATUS_LABELS[key] || key;
  const tone = ['entregado', 'listo para retiro'].includes(key)
    ? 'success'
    : key === 'en camino' || key === 'preparando'
      ? 'warning'
      : 'neutral';
  return `<span class="up-status up-status--${tone}"><span class="up-status-dot" aria-hidden="true"></span>${esc(label)}</span>`;
}

export function demoBadge(isDemo) {
  return isDemo ? '<span class="up-demo-tag">Ejemplo</span>' : '';
}

/** Nota de procedencia: los datos de ejemplo nunca se presentan como verificados. */
export function sourceNote(item) {
  if (!item) return '';
  const source = item.source || 'UP · texto propio (demo)';
  const status = item.status || 'demo';
  const link = item.sourceUrl
    ? ` · <a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Ver fuente</a>`
    : '';
  const verified = item.verifiedAt ? ` · verificado ${esc(formatDate(item.verifiedAt))}` : '';
  return `<p class="up-source-note">Fuente: ${esc(source)} · estado ${esc(status)}${verified}${link} · sin verificación externa.</p>`;
}

const dateFormatter = new Intl.DateTimeFormat('es-CL', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});
const dateTimeFormatter = new Intl.DateTimeFormat('es-CL', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '—';
  return dateFormatter.format(date);
}

export function formatDateTime(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}

export function money(amount) {
  return formatCLP(amount || 0);
}

export function fieldError(id, message) {
  return `<p id="${esc(id)}" class="up-field-error" role="alert">${esc(message)}</p>`;
}

export function showFormErrors(form, errors) {
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  form.querySelectorAll('.up-field-error').forEach((el) => el.remove());
  let first = null;
  for (const error of errors) {
    const field = form.querySelector(`[name="${error.field}"]`);
    if (!field) continue;
    field.setAttribute('aria-invalid', 'true');
    const described = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    const errorId = `error-${error.field}`;
    if (!described.includes(errorId)) {
      described.push(errorId);
      field.setAttribute('aria-describedby', described.join(' '));
    }
    field.insertAdjacentHTML('afterend', fieldError(errorId, error.message));
    if (!first) first = field;
  }
  first?.focus();
}

export function clearFormErrors(form) {
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  form.querySelectorAll('.up-field-error').forEach((el) => el.remove());
}

export function updateAuthLinks() {
  const state = loadState();
  const user = sessionUser(state);
  const loginLink = document.getElementById('login-link');
  const accountLink = document.getElementById('account-link');
  if (loginLink) loginLink.hidden = !!user;
  if (accountLink) {
    accountLink.hidden = !user;
    if (user) {
      accountLink.textContent = `Mi cuenta · ${user.name}`;
      accountLink.setAttribute('aria-label', `Mi cuenta de ${user.name}`);
    }
  }
  return user;
}

const ACCOUNT_SECTIONS = [
  ['resumen', 'Resumen', '#/cuenta'],
  ['pedidos', 'Pedidos', '#/cuenta/pedidos'],
  ['favoritos', 'Favoritos', '#/cuenta/favoritos'],
  ['direcciones', 'Direcciones', '#/cuenta/direcciones'],
  ['beneficios', 'Tarjetas favoritas', '#/cuenta/beneficios'],
  ['perfil', 'Perfil', '#/cuenta/perfil'],
];

export function accountShell(active, body) {
  return `
    <div class="up-account-layout">
      <nav class="up-account-nav" aria-label="Secciones de mi cuenta">
        <h2 data-view-title tabindex="-1">Mi cuenta</h2>
        <ul>
          ${ACCOUNT_SECTIONS.map(
            ([key, label, href]) => `
            <li>
              <a href="${href}" ${key === active ? 'aria-current="page"' : ''}>${esc(label)}</a>
            </li>`
          ).join('')}
        </ul>
        <div class="up-account-nav-foot">
          <span class="up-eyebrow">MODO PRUEBA</span>
          <p>Tus datos viven sólo en este navegador.</p>
          <button type="button" class="up-link-btn" data-open-onboarding>Preferencias de inicio</button>
          <a class="up-link-btn" href="#/ayuda">Ayuda y contacto</a>
        </div>
      </nav>
      <section class="up-account-content" aria-label="Contenido de la cuenta">${body}</section>
    </div>`;
}

export function accountNotice() {
  return `
    <aside class="up-test-notice">
      <strong>MODO PRUEBA</strong>
      <p>No uses tus datos ni contraseñas reales. Para producción se requiere un backend con contraseñas hasheadas (bcrypt/argon2), HTTPS y consentimiento conforme a la ley chilena de protección de datos personales.</p>
    </aside>`;
}
