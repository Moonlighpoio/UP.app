import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canReport,
  createReport,
  effectiveSkuStatus,
  moderateReport,
  reportHistoryFor,
  reportsInLastHour,
} from '../src/reports.js';
import { auditEntry } from '../src/audit.js';
import { trackEvent } from '../src/analytics.js';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const input = {
  productId: 'p1',
  chain: 'lider',
  reason: 'precio-distinto',
  comment: '  El precio en ficha es otro  ',
  userId: 'u1',
};

test('createReport guarda la estructura completa y normaliza comentarios', () => {
  const state = { reports: [] };
  const result = createReport(state, input, { now: NOW });
  assert.equal(result.ok, true);
  const report = result.report;
  assert.equal(report.productId, 'p1');
  assert.equal(report.chain, 'lider');
  assert.equal(report.status, 'abierto');
  assert.equal(report.comment, 'El precio en ficha es otro');
  assert.equal(report.userId, 'u1');
  assert.equal(report.createdAt, '2026-11-24T12:00:00.000Z');
  assert.equal(report.resolvedBy, null);
  assert.equal(report.resolvedAt, null);
});

test('createReport valida motivo, cadena y producto', () => {
  const state = { reports: [] };
  assert.equal(createReport(state, { ...input, chain: 'inexistente' }, { now: NOW }).ok, false);
  assert.equal(createReport(state, { ...input, reason: 'otra' }, { now: NOW }).ok, false);
  assert.equal(createReport(state, { ...input, productId: '' }, { now: NOW }).ok, false);
  assert.equal(state.reports.length, 0);
});

test('límite de 3 reportes por usuario y hora', () => {
  const state = { reports: [] };
  for (let i = 0; i < 3; i += 1) {
    assert.equal(createReport(state, input, { now: NOW + i * 1000 }).ok, true);
  }
  assert.equal(canReport(state, 'u1', { now: NOW + 3000 }), false);
  assert.equal(createReport(state, input, { now: NOW + 3000 }).ok, false);
  assert.equal(reportsInLastHour(state, 'u1', { now: NOW + 3000 }).length, 3);
  assert.equal(createReport(state, { ...input, userId: 'u2' }, { now: NOW + 3000 }).ok, true);
  assert.equal(createReport(state, { ...input, userId: null }, { now: NOW + 3000 }).ok, true);
  assert.equal(canReport(state, 'u1', { now: NOW + 60 * 60 * 1000 + 1 }), true);
});

test('aceptar marca la oferta como pending y escribe auditoría', () => {
  const state = { reports: [], audit: [] };
  const { report } = createReport(state, input, { now: NOW });
  const result = moderateReport(
    state,
    report.id,
    { action: 'aceptar', role: 'admin', resolvedBy: 'admin@ejemplo.cl' },
    { now: NOW + 1000 }
  );
  assert.equal(result.ok, true);
  assert.equal(report.status, 'aceptado');
  assert.equal(report.resolvedAt, '2026-11-24T12:00:01.000Z');
  assert.equal(effectiveSkuStatus(state, 'p1', 'lider', 'verified'), 'pending');
  assert.equal(state.audit.length, 2);
  assert.equal(state.audit[0].action, 'report_created');
  assert.equal(state.audit[1].action, 'reporte_aceptar');
  assert.equal(state.audit[1].role, 'admin');
  assert.deepEqual(state.audit[1].before, { status: 'abierto' });
});

test('rechazar exige motivo y deja rastro; no se puede resolver dos veces', () => {
  const state = { reports: [], audit: [] };
  const { report } = createReport(state, input, { now: NOW });
  assert.equal(moderateReport(state, report.id, { action: 'rechazar' }, { now: NOW }).ok, false);
  const result = moderateReport(
    state,
    report.id,
    { action: 'rechazar', reason: 'Precio revisado y correcto' },
    { now: NOW + 1000 }
  );
  assert.equal(result.ok, true);
  assert.equal(report.status, 'rechazado');
  assert.equal(report.rejectReason, 'Precio revisado y correcto');
  assert.equal(effectiveSkuStatus(state, 'p1', 'lider', 'verified'), 'verified');
  assert.equal(moderateReport(state, report.id, { action: 'aceptar' }, { now: NOW }).ok, false);
  assert.equal(reportHistoryFor(state, 'p1').length, 1);
});

test('auditoría y analítica no guardan secretos ni identificadores personales', () => {
  const state = {};
  const entry = auditEntry({
    who: 'admin@ejemplo.cl',
    role: 'admin',
    action: 'config_cambio',
    entity: 'settings',
    before: { staleDays: 7 },
    after: { staleDays: 8 },
    now: NOW,
  });
  assert.equal(entry.at, '2026-11-24T12:00:00.000Z');
  assert.equal(entry.role, 'admin');

  const event = trackEvent(
    state,
    'report_price',
    { productId: 'p1', email: 'x@ejemplo.cl', userId: 'u1', password: 'secreto' },
    { now: NOW }
  );
  assert.deepEqual(event.props, { productId: 'p1' });
  assert.equal(state.analytics.length, 1);
  assert.equal(trackEvent(state, 'evento_inventado', {}), null);
});
