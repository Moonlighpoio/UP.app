/**
 * UP · Registro de auditoría local (preparación para FASE P1).
 * Guarda quién, rol, acción, entidad, antes/después y fecha. Nunca contraseñas.
 */
const MAX_AUDIT_ENTRIES = 500;

export function auditEntry({
  who = 'anonimo',
  role = 'viewer',
  action,
  entity,
  entityId = null,
  before = null,
  after = null,
  now = Date.now(),
} = {}) {
  return {
    id: `aud_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    who: String(who || 'anonimo').slice(0, 120),
    role: role === 'admin' ? 'admin' : 'viewer',
    action: String(action || 'desconocida').slice(0, 80),
    entity: String(entity || 'desconocida').slice(0, 80),
    entityId: entityId == null ? null : String(entityId).slice(0, 120),
    before: before ?? null,
    after: after ?? null,
    at: new Date(now).toISOString(),
  };
}

export function recordAudit(state, entry) {
  const item = auditEntry(entry);
  state.audit = [...(Array.isArray(state.audit) ? state.audit : []), item].slice(
    -MAX_AUDIT_ENTRIES
  );
  return item;
}
