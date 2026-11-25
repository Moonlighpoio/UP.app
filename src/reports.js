/**
 * UP · Reportes de precio incorrecto (FASE U1).
 * Persisten en up_state_v2; en modo demo la aceptación marca la oferta como
 * `pending` localmente y deja rastro en auditoría. Nunca contiene datos de pago.
 */
import { MAX_REPORTS_PER_HOUR, REPORT_WINDOW_MS, STORES } from './config.js';
import { recordAudit } from './audit.js';

export const REPORT_REASONS = Object.freeze([
  { value: 'precio-distinto', label: 'Precio distinto' },
  { value: 'enlace-roto', label: 'Enlace roto' },
  { value: 'producto-no-disponible', label: 'Producto no disponible' },
  { value: 'otro', label: 'Otro' },
]);

export const REPORT_STATUSES = Object.freeze(['abierto', 'aceptado', 'rechazado']);

export function reportActor(userId) {
  return userId || 'anonimo';
}

export function reportsInLastHour(state, userId, { now = Date.now() } = {}) {
  const actor = reportActor(userId);
  const since = now - REPORT_WINDOW_MS;
  return (Array.isArray(state.reports) ? state.reports : []).filter((report) => {
    if (reportActor(report.userId) !== actor) return false;
    const at = Date.parse(report.createdAt);
    return Number.isFinite(at) && at >= since;
  });
}

export function canReport(state, userId, options = {}) {
  return (
    reportsInLastHour(state, userId, options).length < (options.maxReports ?? MAX_REPORTS_PER_HOUR)
  );
}

export function createReport(state, input, { now = Date.now() } = {}) {
  const productId = String(input?.productId || '').trim();
  const chain = String(input?.chain || '').trim();
  const reason = String(input?.reason || '').trim();
  const comment = String(input?.comment || '')
    .trim()
    .slice(0, 500);
  const userId = input?.userId || null;

  if (!productId) return { ok: false, error: 'Falta el producto.' };
  if (!STORES[chain]) return { ok: false, error: 'Elige una cadena válida.' };
  if (!REPORT_REASONS.some((item) => item.value === reason)) {
    return { ok: false, error: 'Elige un motivo.' };
  }
  if (!canReport(state, userId, { now })) {
    return {
      ok: false,
      error: `Máximo ${MAX_REPORTS_PER_HOUR} reportes por hora. Inténtalo más tarde.`,
    };
  }

  const report = {
    id: `rep_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    productId,
    chain,
    reason,
    comment,
    userId,
    createdAt: new Date(now).toISOString(),
    status: 'abierto',
    resolvedBy: null,
    resolvedAt: null,
  };
  state.reports = [...(Array.isArray(state.reports) ? state.reports : []), report];
  return { ok: true, report };
}

export function overrideKey(productId, chain) {
  return `${productId}_${chain}`;
}

export function effectiveSkuStatus(state, productId, chain, status) {
  const override = state.overrides?.[overrideKey(productId, chain)];
  return override?.status === 'pending' ? 'pending' : status;
}

/** Aceptar marca la oferta como pendiente; rechazar exige motivo. */
export function moderateReport(state, id, input, { now = Date.now() } = {}) {
  const report = (state.reports || []).find((item) => item.id === id);
  if (!report) return { ok: false, error: 'Reporte no encontrado.' };
  if (report.status !== 'abierto') return { ok: false, error: 'El reporte ya fue resuelto.' };
  const action = input?.action === 'aceptar' ? 'aceptar' : 'rechazar';
  const reason = String(input?.reason || '')
    .trim()
    .slice(0, 300);
  if (action === 'rechazar' && !reason) {
    return { ok: false, error: 'Indica el motivo del rechazo.' };
  }

  const before = { status: report.status };
  report.status = action === 'aceptar' ? 'aceptado' : 'rechazado';
  report.resolvedBy = String(input?.resolvedBy || 'admin').slice(0, 120);
  report.resolvedAt = new Date(now).toISOString();
  if (action === 'rechazar') report.rejectReason = reason;

  if (action === 'aceptar') {
    state.overrides = state.overrides || {};
    state.overrides[overrideKey(report.productId, report.chain)] = {
      status: 'pending',
      at: report.resolvedAt,
      reportId: report.id,
    };
  }

  recordAudit(state, {
    who: report.resolvedBy,
    role: input?.role === 'admin' ? 'admin' : 'viewer',
    action: action === 'aceptar' ? 'reporte_aceptar' : 'reporte_rechazar',
    entity: 'report',
    entityId: report.id,
    before,
    after: { status: report.status, reason: reason || null },
    now,
  });
  return { ok: true, report };
}

export function reportHistoryFor(state, productId) {
  return (state.reports || [])
    .filter((report) => report.productId === productId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
