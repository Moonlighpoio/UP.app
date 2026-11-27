import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_COMMANDS, filterAdminCommands } from '../src/admin-search.js';
import { ADMIN_SECTIONS } from '../src/admin.js';

test('el buscador global incluye todas las secciones del panel y accesos rápidos', () => {
  assert.ok(
    ADMIN_SECTIONS.every((section) => ADMIN_COMMANDS.some((item) => item.id === section.id))
  );
  assert.ok(ADMIN_COMMANDS.some((item) => item.route === '#/'));
});

test('el buscador tolera acentos, mayúsculas y búsquedas por ruta', () => {
  assert.deepEqual(
    filterAdminCommands('AUDIToRIA').map((item) => item.id),
    ['auditoria']
  );
  assert.deepEqual(
    filterAdminCommands('calidad de datos').map((item) => item.id),
    ['datos']
  );
  assert.ok(filterAdminCommands('#/admin/pedidos').some((item) => item.id === 'pedidos'));
});

test('sin coincidencias el buscador no inventa resultados', () => {
  assert.deepEqual(filterAdminCommands('seccion-que-no-existe'), []);
  assert.deepEqual(
    filterAdminCommands('').map((item) => item.id),
    ADMIN_COMMANDS.map((item) => item.id)
  );
});
