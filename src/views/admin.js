/** Vistas del panel `#/admin` (FASE P1): estructura, roles y auditoría. */
import { esc } from '../utils.js';
import { loadState, updateState } from '../storage.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, sessionUser } from '../auth.js';
import { adminShell, auditJson, auditMarkup, setTesterRole } from '../admin.js';
import { mountAdminSearch } from '../admin-search.js';
import { ADMIN_SECTIONS } from '../admin.js';

const SECTION_COPY = {
  funciones: 'Inventario de funcionalidades, feature flags y checklist de QA.',
  catalogo: 'Productos, ofertas por cadena y edición controlada.',
  datos: 'Matriz de mapeo, coincidencias y calidad de precios.',
  reportes: 'Cola de moderación e historial por producto.',
  alertas: 'Avisos de precio y notificaciones locales.',
  pedidos: 'Pedidos de prueba y estado de la simulación.',
  config: 'Ajustes del prototipo. Requiere rol admin en esta sesión local.',
};

function demoAccountsMarkup() {
  return `<section class="up-admin-card" aria-labelledby="admin-demo-accounts">
    <span class="up-eyebrow">CUENTAS PÚBLICAS DE PRUEBA</span>
    <h2 id="admin-demo-accounts">Acceso demo</h2>
    <p class="up-text-muted">Sólo para explorar el prototipo. No protegen información real.</p>
    <ul class="up-admin-kv">
      ${DEMO_ACCOUNTS.map(
        (account) => `<li><strong>${esc(account.role)}</strong> · ${esc(account.email)}</li>`
      ).join('')}
    </ul>
    <p class="up-text-muted">Contraseña pública de prueba: <code>${esc(DEMO_PASSWORD)}</code></p>
  </section>`;
}

function kpiMarkup(state) {
  const cards = [
    ['Usuarios locales', state.users.length],
    ['Reportes guardados', state.reports.length],
    ['Alertas activas', state.alerts.length],
    ['Entradas de auditoría', state.audit.length],
  ];
  return `<div class="up-admin-kpis">${cards
    .map(
      ([label, value]) => `<div class="up-admin-kpi">
        <span class="up-eyebrow">${esc(label)}</span>
        <strong>${Number(value) || 0}</strong>
      </div>`
    )
    .join('')}</div>`;
}

function sectionBody(sectionId, state) {
  if (sectionId === 'resumen') {
    return `
      ${kpiMarkup(state)}
      <section class="up-admin-card" aria-labelledby="admin-structure-title">
        <span class="up-eyebrow">ESTRUCTURA P1</span>
        <h2 id="admin-structure-title">Panel listo para las secciones</h2>
        <p>Las rutas, el guard de rol, las migas de pan, el buscador global y la auditoría ya funcionan. Cada sección se completará en la FASE P2.</p>
        <p class="up-text-muted">${ADMIN_SECTIONS.length} secciones disponibles en la navegación lateral.</p>
      </section>
      ${demoAccountsMarkup()}
      <section class="up-admin-card" aria-labelledby="admin-activity-title">
        <span class="up-eyebrow">ACTIVIDAD LOCAL</span>
        <h2 id="admin-activity-title">Últimas escrituras</h2>
        ${auditMarkup(state)}
      </section>`;
  }
  if (sectionId === 'auditoria') {
    return `
      <section class="up-admin-card" aria-labelledby="admin-audit-title">
        <div class="up-admin-card-head">
          <div>
            <span class="up-eyebrow">REGISTRO LOCAL</span>
            <h2 id="admin-audit-title">Auditoría de escrituras</h2>
          </div>
          <button type="button" id="admin-audit-export" class="up-btn-primary">Exportar JSON</button>
        </div>
        <p id="admin-audit-status" class="up-text-muted" role="status" aria-live="polite"></p>
        ${auditMarkup(state)}
        <details class="up-admin-json">
          <summary>Ver JSON exportable</summary>
          <pre id="admin-audit-json">${esc(auditJson(state))}</pre>
        </details>
      </section>`;
  }
  return `
    <section class="up-admin-card" aria-labelledby="admin-placeholder-title">
      <span class="up-eyebrow">SECCIÓN PREPARADA</span>
      <h2 id="admin-placeholder-title">${esc(SECTION_COPY[sectionId] || 'Contenido de demostración')}</h2>
      <p>La ruta está protegida y visible en el menú. Su contenido operativo se construye en la FASE P2.</p>
      <p class="up-text-muted">Mientras tanto puedes usar Ctrl/⌘ + K para saltar a otra sección o volver al catálogo.</p>
    </section>`;
}

function bindTesterToggle(container, ctx) {
  const toggle = container.querySelector('#admin-tester-toggle');
  toggle?.addEventListener('change', () => {
    const role = toggle.checked ? 'admin' : 'viewer';
    const changed = updateState((state) => setTesterRole(state, role));
    if (!changed) {
      toggle.checked = !toggle.checked;
      return;
    }
    const query = new URLSearchParams(ctx.query);
    query.delete('denied');
    const suffix = query.toString() ? `?${query}` : '';
    ctx.navigate(`#${ctx.path}${suffix}`);
  });
}

function bindAuditExport(container) {
  const button = container.querySelector('#admin-audit-export');
  const status = container.querySelector('#admin-audit-status');
  button?.addEventListener('click', () => {
    const json = auditJson(loadState());
    const preview = container.querySelector('#admin-audit-json');
    if (preview) preview.textContent = json;
    try {
      const url = URL.createObjectURL(new globalThis.Blob([json], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'up-auditoria-demo.json';
      anchor.click();
      URL.revokeObjectURL(url);
      if (status) status.textContent = 'Archivo de auditoría preparado para descargar.';
    } catch {
      if (status)
        status.textContent = 'El navegador bloqueó la descarga; usa «Ver JSON exportable».';
    }
  });
}

function bindMenuToggle(container) {
  const button = container.querySelector('#admin-menu-toggle');
  button?.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!open));
    container.querySelector('#admin-menu-list')?.classList.toggle('is-open', !open);
  });
}

export function adminView(sectionId) {
  let search = null;

  return {
    element: 'view-dynamic',
    render(container, ctx) {
      const state = loadState();
      const user = sessionUser(state);
      const readOnly = user?.role !== 'admin';
      const denied = ctx.query.get('denied') === '1';
      const deniedMarkup = denied
        ? '<aside class="up-test-notice" role="alert"><strong>ACCESO DENEGADO</strong><p>Esa sección requiere el rol admin. Activa «Modo tester» o ingresa con la cuenta admin de prueba.</p></aside>'
        : '';
      container.innerHTML = adminShell(
        sectionId,
        `${deniedMarkup}${sectionBody(sectionId, state)}`,
        { readOnly, user }
      );
      bindMenuToggle(container);
      bindTesterToggle(container, ctx);
      bindAuditExport(container);
      search = mountAdminSearch(ctx);
    },
    destroy() {
      search?.close();
      search = null;
    },
  };
}
