import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEATURES,
  isFeatureEnabled,
  normalizeFlags,
  setFlag,
  visibleRoutes,
} from '../src/flags.js';

test('el inventario cubre todas las áreas de la web y por defecto están activas', () => {
  const needed = [
    'catalogo',
    'detalle',
    'comparador',
    'carrito',
    'checkout',
    'sesion',
    'cuenta',
    'pedidos',
    'tiendas',
    'ofertas',
    'tarjetas',
    'favoritos',
    'lista',
    'alertas',
    'reportes',
    'onboarding',
    'pwa',
    'transiciones',
  ];
  assert.deepEqual(
    FEATURES.map((item) => item.id),
    needed
  );
  assert.ok(Object.values(normalizeFlags(null)).every((value) => value === true));
  assert.equal(visibleRoutes(null).length, needed.length);
});

test('desactivar una flag oculta la ruta y registra auditoría local sin datos personales', () => {
  const saved = { analytics: [], audit: [], flags: {}, users: [], session: null };
  assert.equal(setFlag(saved, 'comparar', true), false);
  assert.equal(setFlag(saved, 'comparador', false), true);
  assert.equal(isFeatureEnabled(saved.flags, 'comparador'), false);
  assert.ok(!visibleRoutes(saved.flags).some((item) => item.id === 'comparador'));
  assert.equal(saved.analytics.length, 1);
  assert.equal(saved.analytics[0].event, 'flag_changed');
  assert.deepEqual(saved.analytics[0].props, { featureId: 'comparador', enabled: false });
  assert.equal(saved.audit.length, 1);
  assert.equal(saved.audit[0].action, 'flag_changed');
  assert.equal(saved.audit[0].entity, 'flag');
  assert.equal(saved.audit[0].entityId, 'comparador');
  assert.deepEqual(saved.audit[0].before, { enabled: true });
  assert.deepEqual(saved.audit[0].after, { enabled: false });
});

test('flags corruptos vuelven a valores seguros', () => {
  const clean = normalizeFlags({ comparador: 'si', lista: false, 'otra-cosa': true });
  assert.equal(clean.comparador, false);
  assert.equal(clean.lista, false);
  assert.equal(Object.hasOwn(clean, 'otra-cosa'), false);
});
