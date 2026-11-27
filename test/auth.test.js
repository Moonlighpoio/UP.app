import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  SESSION_TTL_MS,
  canWrite,
  constantTimeEqual,
  createSession,
  isAdminUser,
  isSessionValid,
  loginUser,
  passwordStrength,
  registerUser,
  seedDemoAccounts,
  sessionUser,
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

test('las cuentas demo públicas se siembran una vez con hash y roles', async () => {
  const state = { users: [], session: null, profile: null };
  const added = await seedDemoAccounts(state);
  assert.deepEqual(
    added.map((user) => user.role),
    ['admin', 'viewer']
  );
  assert.equal(state.users.length, 2);
  assert.equal(JSON.stringify(state).includes(DEMO_PASSWORD), false);
  assert.equal(await seedDemoAccounts(state).then((items) => items.length), 0);

  const login = await loginUser(state, {
    email: 'admin-demo@ejemplo.cl',
    password: DEMO_PASSWORD,
  });
  assert.equal(login.ok, true);
  assert.equal(login.user.isDemo, true);
  assert.equal(isAdminUser(sessionUser(state)), true);
  assert.equal(canWrite(sessionUser(state)), true);
  assert.equal(canWrite(state.users.find((user) => user.role === 'viewer')), false);
});

test('usuarios inactivos no pueden iniciar sesión ni conservar sesión', async () => {
  const state = { users: [], session: null, profile: null };
  await seedDemoAccounts(state);
  const user = state.users[0];
  user.active = false;
  state.session = createSession(user.id);
  assert.equal(sessionUser(state), null);
  assert.equal((await loginUser(state, { email: user.email, password: DEMO_PASSWORD })).ok, false);
});

test('la comparación en tiempo constante rechaza longitudes y valores distintos', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual('abc', 'abcd'), false);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
  assert.equal(constantTimeEqual(null, 'abc'), false);
  assert.equal(DEMO_ACCOUNTS.length, 2);
});
