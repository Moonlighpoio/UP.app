import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearNotifications,
  createAlert,
  evaluateAlerts,
  markAllRead,
  removeAlert,
  unreadCount,
} from '../src/alerts.js';
import { overrideKey } from '../src/reports.js';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const verified = { status: 'verified', verifiedAt: new Date(NOW - 3600_000).toISOString() };
const pending = { status: 'pending', verifiedAt: new Date(NOW - 3600_000).toISOString() };
const products = [
  {
    id: 'leche',
    name: 'Leche',
    prices: { lider: 1000, jumbo: 1200 },
    skus: { lider: verified, jumbo: pending },
  },
];

test('crear alerta valida y registra alert_created sin datos personales', () => {
  const state = { alerts: [], notifications: [], analytics: [] };
  assert.equal(
    createAlert(
      state,
      { productId: 'leche', chain: 'inexistente', targetPrice: 900 },
      { now: NOW }
    ),
    null
  );
  assert.equal(
    createAlert(state, { productId: 'leche', chain: 'lider', targetPrice: 0 }, { now: NOW }),
    null
  );
  const alert = createAlert(
    state,
    { productId: 'leche', chain: 'lider', targetPrice: 900 },
    { now: NOW }
  );
  assert.equal(alert.targetPrice, 900);
  assert.equal(alert.active, true);
  assert.deepEqual(
    state.analytics.map((event) => event.event),
    ['alert_created']
  );
  assert.equal(state.analytics[0].props.productId, 'leche');
  assert.equal(removeAlert(state, alert.id), true);
  assert.equal(state.alerts.length, 0);
});

test('las alertas sólo se disparan con oferta verificada, fresca y alcanzada', () => {
  const state = { alerts: [], notifications: [], analytics: [], overrides: {} };
  const accepted = createAlert(
    state,
    { productId: 'leche', chain: 'lider', targetPrice: 1100 },
    { now: NOW }
  );
  const notAccepted = createAlert(
    state,
    { productId: 'leche', chain: 'jumbo', targetPrice: 2000 },
    { now: NOW }
  );
  assert.equal(evaluateAlerts(state, products, { now: NOW }), 1);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].alertId, accepted.id);
  assert.match(state.notifications[0].message, /Leche/);
  assert.equal(evaluateAlerts(state, products, { now: NOW }), 0);
  assert.equal(
    state.notifications.some((n) => n.alertId === notAccepted.id),
    false
  );
  assert.equal(unreadCount(state), 1);
  markAllRead(state);
  assert.equal(unreadCount(state), 0);
  clearNotifications(state);
  assert.deepEqual(state.notifications, []);
});

test('un override pendiente bloquea una alerta previamente alcanzada', () => {
  const state = {
    alerts: [],
    notifications: [],
    analytics: [],
    overrides: { [overrideKey('leche', 'lider')]: { status: 'pending' } },
  };
  createAlert(state, { productId: 'leche', chain: 'lider', targetPrice: 1100 }, { now: NOW });
  assert.equal(evaluateAlerts(state, products, { now: NOW }), 0);
});
