import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VIEW_TRANSITION_MS,
  loginTarget,
  matchRoute,
  parseHash,
  requiresSession,
  viewTransitionAllowed,
} from '../src/router.js';

const routes = [
  { path: '/', view: 'home' },
  { path: '/producto/:id', view: 'product' },
  { path: '/cuenta/pedidos/:id', view: 'detail' },
  { path: '*', view: 'notFound' },
];

test('el router distingue rutas hash de anclas internas', () => {
  assert.deepEqual(parseHash('#/producto/coca-original-15l').path, '/producto/coca-original-15l');
  assert.deepEqual(parseHash('#/login?next=%23%2Fcuenta').query.get('next'), '#/cuenta');
  assert.equal(parseHash('#catalogo'), null);
  assert.equal(parseHash('#top'), null);
});

test('las rutas con parámetros resuelven y decodifican el id', () => {
  const product = matchRoute(routes, '/producto/leche%20entera');
  assert.equal(product.route.view, 'product');
  assert.equal(product.params.id, 'leche entera');

  const detail = matchRoute(routes, '/cuenta/pedidos/UP-000123');
  assert.equal(detail.route.view, 'detail');
  assert.equal(detail.params.id, 'UP-000123');

  assert.equal(matchRoute(routes, '/no-existe').route.view, 'notFound');
});

test('las rutas privadas redirigen al login conservando el destino', () => {
  assert.equal(requiresSession('/cuenta'), true);
  assert.equal(requiresSession('/cuenta/pedidos/UP-000123'), true);
  assert.equal(requiresSession('/checkout'), true);
  assert.equal(requiresSession('/producto/arroz-1kg'), false);
  assert.equal(loginTarget('/checkout'), '#/login?next=%23%2Fcheckout');
});

test('las transiciones se omiten en la carga inicial y con movimiento reducido', () => {
  assert.equal(VIEW_TRANSITION_MS, 180);
  assert.equal(viewTransitionAllowed(false, false), true);
  assert.equal(viewTransitionAllowed(false, true), false);
  assert.equal(viewTransitionAllowed(true, false), false);
  assert.equal(viewTransitionAllowed(true, true), false);
});
