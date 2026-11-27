import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_SECTIONS,
  adminCrumbs,
  adminShell,
  auditJson,
  auditMarkup,
  recordWrite,
  setTesterRole,
  setUserRole,
} from '../src/admin.js';
import { createSession, DEMO_PASSWORD } from '../src/auth.js';

function stateWithSession(role = 'viewer') {
  return {
    users: [
      { id: 'u1', name: 'Administrador demo', email: 'admin-demo@ejemplo.cl', role, active: true },
    ],
    session: createSession('u1'),
    audit: [],
  };
}

test('el panel expone todas las secciones planeadas y migas accesibles', () => {
  assert.deepEqual(
    ADMIN_SECTIONS.map((item) => item.id),
    [
      'resumen',
      'funciones',
      'catalogo',
      'datos',
      'reportes',
      'alertas',
      'pedidos',
      'config',
      'auditoria',
    ]
  );
  const crumbs = adminCrumbs('auditoria');
  assert.match(crumbs, /aria-label="Ruta del panel"/);
  assert.match(crumbs, /aria-current="page">Auditoría/);
});

test('el shell muestra usuario, salida, aviso NO seguro e interruptor Modo tester', () => {
  const html = adminShell('resumen', '<p>cuerpo</p>', {
    user: { name: 'Administrador demo', role: 'admin' },
  });
  assert.match(html, /Salir del panel/);
  assert.match(html, /Administrador demo/);
  assert.match(html, /NO es seguro/);
  assert.match(html, /Modo tester: permiso de administrador local/);
  assert.match(html, /aria-current="page">Resumen/);
  assert.match(html, /<h1 data-view-title tabindex="-1">Resumen<\/h1>/);
});

test('cambiar roles registra who, role, action, entity, entityId, before, after y at', () => {
  const state = stateWithSession('viewer');
  const changed = setUserRole(state, 'u1', 'admin');
  assert.equal(changed.role, 'admin');
  assert.equal(state.audit.length, 1);
  const entry = state.audit[0];
  assert.equal(entry.who, 'Administrador demo');
  assert.equal(entry.role, 'viewer');
  assert.equal(entry.action, 'role_changed');
  assert.equal(entry.entity, 'user');
  assert.equal(entry.entityId, 'u1');
  assert.deepEqual(entry.before, { role: 'viewer' });
  assert.deepEqual(entry.after, { role: 'admin' });
  assert.ok(Number.isFinite(Date.parse(entry.at)));
  assert.equal(setUserRole(state, 'u1', 'admin'), null);
});

test('Modo tester sólo cambia la sesión local y rechaza roles inválidos', () => {
  const state = stateWithSession('viewer');
  assert.equal(setTesterRole(state, 'root'), null);
  assert.equal(setTesterRole(state, 'admin')?.role, 'admin');
  assert.equal(setTesterRole({ users: [], session: null }, 'admin'), null);
  assert.equal(state.users[0].passwordHash, undefined);
});

test('la auditoría es visible y exportable sin secretos', () => {
  const state = stateWithSession('admin');
  recordWrite(state, {
    action: 'config_cambio',
    entity: 'settings',
    entityId: 's1',
    before: { email: 'secreto@ejemplo.cl', passwordHash: 'hash', staleDays: 7 },
    after: { staleDays: 8, token: 'super-secreto' },
  });
  const markup = auditMarkup(state);
  assert.match(markup, /<time datetime=/);
  assert.match(markup, /config_cambio/);
  assert.match(markup, /7 → 8|staleDays/);
  const json = auditJson(state);
  assert.equal(JSON.parse(json).entries.length, 1);
  assert.equal(json.includes('super-secreto'), false);
  assert.equal(json.includes('secreto@ejemplo.cl'), false);
  assert.equal(json.includes(DEMO_PASSWORD), false);
  assert.equal(JSON.parse(json).demo, true);
});

test('sin escrituras, la auditoría muestra un estado vacío claro', () => {
  assert.match(auditMarkup({}), /Todavía no hay escrituras/);
});
