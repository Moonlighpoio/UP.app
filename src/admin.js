/**
 * UP · Panel de administración local (FASE P1).
 * Sólo demostración: los roles y el interruptor «Modo tester» viven en este
 * navegador y NO son un control de acceso seguro.
 */
import { esc } from './utils.js';
import { sessionUser } from './auth.js';
import { auditEntry, recordAudit } from './audit.js';

const dateTimeFormatter = new Intl.DateTimeFormat('es-CL', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDateTime(iso) {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? dateTimeFormatter.format(date) : '—';
}

export const ADMIN_SECTIONS = Object.freeze([
  { id: 'resumen', label: 'Resumen', route: '#/admin', hint: 'KPI y actividad' },
  { id: 'funciones', label: 'Funciones', route: '#/admin/funciones', hint: 'Flags y QA' },
  { id: 'catalogo', label: 'Catálogo', route: '#/admin/catalogo', hint: 'Productos y ofertas' },
  { id: 'datos', label: 'Calidad de datos', route: '#/admin/datos', hint: 'Mapeo y frescura' },
  { id: 'reportes', label: 'Reportes', route: '#/admin/reportes', hint: 'Moderación' },
  { id: 'alertas', label: 'Alertas', route: '#/admin/alertas', hint: 'Avisos de precio' },
  { id: 'pedidos', label: 'Pedidos', route: '#/admin/pedidos', hint: 'Demo y seguimiento' },
  { id: 'config', label: 'Configuración', route: '#/admin/config', hint: 'Sólo administrador' },
  {
    id: 'auditoria',
    label: 'Auditoría',
    route: '#/admin/auditoria',
    hint: 'Historial y exportación',
  },
]);

const SENSITIVE = new Set([
  'password',
  'passwordHash',
  'token',
  'session',
  'salt',
  'hash',
  'email',
]);

function cleanAuditValue(value, depth = 0) {
  if (depth > 4 || value == null) return value ?? null;
  if (Array.isArray(value))
    return value.slice(0, 20).map((item) => cleanAuditValue(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE.has(key)) continue;
      out[key] = cleanAuditValue(item, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return value.slice(0, 300);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
}

/** Toda escritura del panel pasa por aquí: identidad verificada desde la sesión. */
export function recordWrite(
  state,
  {
    action,
    entity,
    entityId = null,
    before = null,
    after = null,
    now = Date.now(),
    role: recordRole = null,
  }
) {
  const user = sessionUser(state);
  const effectiveRole =
    recordRole === 'admin' || recordRole === 'viewer'
      ? recordRole
      : user?.role === 'admin'
        ? 'admin'
        : 'viewer';
  return recordAudit(state, {
    who: user?.name || 'anonimo',
    role: effectiveRole,
    action,
    entity,
    entityId,
    before: cleanAuditValue(before),
    after: cleanAuditValue(after),
    now,
  });
}

export function setUserRole(state, userId, role) {
  if (!['admin', 'viewer'].includes(role)) return null;
  const user = state.users?.find((item) => item.id === userId);
  if (!user || user.role === role) return null;
  const before = { role: user.role };
  const actorRole = sessionUser(state)?.role === 'admin' ? 'admin' : 'viewer';
  user.role = role;
  recordWrite(state, {
    action: 'role_changed',
    entity: 'user',
    entityId: userId,
    before,
    after: { role },
    role: actorRole,
  });
  return user;
}

/** El tester se otorga/quita el rol en su propia sesión local, sin seguridad real. */
export function setTesterRole(state, role) {
  const user = sessionUser(state);
  if (!user || !['admin', 'viewer'].includes(role)) return null;
  return setUserRole(state, user.id, role);
}

export function adminCrumbs(activeId) {
  const section = ADMIN_SECTIONS.find((item) => item.id === activeId) || ADMIN_SECTIONS[0];
  return `<nav class="up-breadcrumb" aria-label="Ruta del panel">
    <a href="#/">Inicio</a><span aria-hidden="true">›</span>
    <a href="#/admin">Panel</a><span aria-hidden="true">›</span>
    <span aria-current="page">${esc(section.label)}</span>
  </nav>`;
}

export function adminShell(
  activeId,
  body,
  { title = sectionLabel(activeId), readOnly = false, user = null } = {}
) {
  const links = ADMIN_SECTIONS.map(
    (item) =>
      `<li><a href="${item.route}" ${
        item.id === activeId ? 'aria-current="page"' : ''
      }>${esc(item.label)}</a></li>`
  ).join('');
  const role = user?.role === 'admin' ? 'admin' : 'viewer';
  return `
    <div class="up-admin-layout">
      <header class="up-admin-topbar">
        <a href="#/" class="up-logo" aria-label="UP, volver al inicio">
          <img class="up-logo-img" src="assets/brand/up-logo.jpeg" alt="UP" width="48" height="27" />
        </a>
        <div class="up-admin-topbar-meta">
          <span class="up-eyebrow">PANEL DE PRUEBA · ${role === 'admin' ? 'ADMIN' : 'VIEWER'}</span>
          <span>${esc(user?.name || 'Sesión local')}</span>
          <a class="up-link-btn" href="#/cuenta">Salir del panel</a>
        </div>
      </header>
      <div class="up-admin-body">
        <nav class="up-admin-nav" aria-label="Secciones del panel">
          <h2>Panel UP</h2>
          <button type="button" id="admin-menu-toggle" class="up-btn-secondary up-admin-menu-toggle" aria-expanded="false" aria-controls="admin-menu-list">Menú del panel</button>
          <ul id="admin-menu-list">${links}</ul>
          <div class="up-admin-nav-foot">
            <span class="up-eyebrow">MODO TESTER</span>
            <p>Este control es sólo del navegador y NO es seguro: cualquiera puede alterarlo.</p>
            <label class="up-switch">
              <input type="checkbox" id="admin-tester-toggle" ${
                role === 'admin' ? 'checked' : ''
              } />
              <span>Modo tester: permiso de administrador local</span>
            </label>
          </div>
        </nav>
        <main class="up-admin-content" aria-label="Contenido del panel">
          ${adminCrumbs(activeId)}
          <aside class="up-admin-note">
            <strong>PANEL DE DEMOSTRACIÓN</strong>
            <p>Los roles se guardan sólo en este navegador y no protegen datos reales.</p>
          </aside>
          ${
            readOnly
              ? '<aside class="up-test-notice"><strong>SOLO LECTURA</strong><p>Tu rol es viewer: puedes explorar, pero no escribir ni cambiar flags.</p></aside>'
              : ''
          }
          <h1 data-view-title tabindex="-1">${esc(title)}</h1>
          ${body}
        </main>
      </div>
    </div>`;
}

function sectionLabel(id) {
  return ADMIN_SECTIONS.find((item) => item.id === id)?.label || 'Panel';
}

function auditChange(item) {
  const before = item.before == null ? '—' : JSON.stringify(item.before);
  const after = item.after == null ? '—' : JSON.stringify(item.after);
  return `${before} → ${after}`;
}

export function auditMarkup(state) {
  const entries = [...(Array.isArray(state.audit) ? state.audit : [])].reverse();
  if (!entries.length) {
    return '<p class="up-text-muted">Todavía no hay escrituras registradas en este navegador.</p>';
  }
  return `<div class="up-table-wrap"><table class="up-data-table">
    <caption>Historial local de escrituras. Sin contraseñas ni datos de tarjeta.</caption>
    <thead><tr>
      <th scope="col">Fecha</th><th scope="col">Quién</th><th scope="col">Rol</th>
      <th scope="col">Acción</th><th scope="col">Entidad</th><th scope="col">Antes → después</th>
    </tr></thead>
    <tbody>${entries
      .map(
        (item) => `<tr>
          <td><time datetime="${esc(item.at)}">${esc(formatDateTime(item.at))}</time></td>
          <td>${esc(item.who || 'anonimo')}</td>
          <td>${esc(item.role || 'viewer')}</td>
          <td>${esc(item.action)}</td>
          <td>${esc(item.entity)}${item.entityId ? ` · ${esc(item.entityId)}` : ''}</td>
          <td><code>${esc(auditChange(item))}</code></td>
        </tr>`
      )
      .join('')}</tbody>
  </table></div>`;
}

export function auditJson(state) {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      demo: true,
      note: 'Registro local del prototipo UP. NO es un control de acceso seguro.',
      entries: Array.isArray(state.audit) ? state.audit : [],
    },
    null,
    2
  );
}

export { auditEntry };
