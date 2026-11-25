import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_TTL_MS,
  createSession,
  isSessionValid,
  loginUser,
  passwordStrength,
  registerUser,
  validateRegistration,
  verifyPassword,
} from '../src/auth.js';

const validInput = () => ({
  name: 'Usuario Prueba',
  email: 'prueba@ejemplo.cl',
  password: 'ClaveDePrueba123!',
  terms: true,
});

test('la contraseña se deriva con sal y se verifica sin guardar texto plano', async () => {
  const record = await registerUser({ users: [], session: null, profile: null }, validInput()).then(
    (result) => result.user.passwordHash
  );

  assert.equal(record.algorithm, 'PBKDF2-SHA256');
  assert.ok(record.salt && record.hash);
  assert.ok(record.iterations >= 100000);
  assert.equal(JSON.stringify(record).includes('ClaveDePrueba123!'), false);
  assert.equal(await verifyPassword('ClaveDePrueba123!', record), true);
  assert.equal(await verifyPassword('OtraClave123!', record), false);
});

test('registro valida nombre, correo, contraseña y términos', () => {
  const errors = validateRegistration({
    name: 'A',
    email: 'no-es-correo',
    password: '123',
    terms: false,
  });
  assert.deepEqual(
    errors.map((error) => error.field),
    ['name', 'email', 'password', 'terms']
  );
  const strong = passwordStrength('MuyLarga123!ConSimbolo');
  assert.equal(strong.level, 'strong');
  assert.equal(passwordStrength('corta').level, 'weak');
});

test('la sesión expira y el login correcto conserva el carrito del estado', async () => {
  const state = { users: [], session: null, profile: null, cart: [{ key: 'a_lider', qty: 2 }] };
  const created = await registerUser(state, validInput());
  assert.equal(created.ok, true);
  assert.equal(isSessionValid(state.session), true);
  assert.equal(state.cart.length, 1);

  const logged = await loginUser(state, {
    email: ' PRUEBA@EJEMPLO.CL ',
    password: 'ClaveDePrueba123!',
  });
  assert.equal(logged.ok, true);
  assert.equal(state.users.length, 1);

  const bad = await loginUser(state, { email: 'prueba@ejemplo.cl', password: 'incorrecta' });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].field, 'password');

  const expired = createSession('usr_1', { now: 1000, ttlMs: SESSION_TTL_MS });
  assert.equal(isSessionValid(expired, { now: 1000 + SESSION_TTL_MS + 1 }), false);
  assert.equal(isSessionValid(null), false);
});
