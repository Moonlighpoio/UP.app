/**
 * UP · Siembra idempotente de las cuentas públicas de prueba (FASE P1).
 * `initApp` y `#/login` pueden pedirla en el mismo tick: una sola promesa evita
 * duplicar usuarios cuando PBKDF2 todavía está derivando los hashes.
 */
import { updateStateAsync } from './storage.js';
import { seedDemoAccounts } from './auth.js';

let pending = null;
let seeded = false;

export function ensureDemoAccounts() {
  if (seeded) return Promise.resolve([]);
  if (!pending) {
    pending = updateStateAsync(seedDemoAccounts)
      .then((added) => {
        seeded = true;
        return added;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}
