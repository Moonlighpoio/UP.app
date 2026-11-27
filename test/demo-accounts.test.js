import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureDemoAccounts } from '../src/demo-accounts.js';
import { loadState } from '../src/storage.js';

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
  clear: () => values.clear(),
};

test('la siembra concurrente de cuentas demo crea exactamente dos usuarios', async () => {
  const [first, second] = await Promise.all([ensureDemoAccounts(), ensureDemoAccounts()]);
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  const state = loadState();
  assert.deepEqual(state.users.map((user) => user.email).sort(), [
    'admin-demo@ejemplo.cl',
    'viewer-demo@ejemplo.cl',
  ]);
  assert.equal(state.users.filter((user) => user.role === 'admin').length, 1);
  assert.equal(JSON.stringify(state).includes('ClaveDePrueba123!'), false);
});
