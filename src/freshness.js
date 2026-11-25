/**
 * UP · Frescura de precios (FASE U1). Funciones puras, sin DOM ni almacenamiento.
 * El contrato del front no expone `capturedAt`: la fecha de captura se deriva de
 * `priceCapturedAt` (precio) o, en su defecto, de `verifiedAt` (identificador).
 */
import { STALE_MS } from './config.js';

export const FRESHNESS_TONES = Object.freeze(['ok', 'warning', 'neutral']);

/** Devuelve ISO válido o null. Nunca inventa fecha. */
export function capturedAtOf(sku) {
  const value = sku?.priceCapturedAt || sku?.verifiedAt || null;
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** Edad legible en español, sin dependencias. */
export function humanAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'sin fecha';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} d`;
  const months = Math.floor(days / 30);
  return `hace ${months} mes${months === 1 ? '' : 'es'}`;
}

export function shortDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' });
}

/**
 * Estado de frescura de una oferta. `stale` cuando supera el umbral o cuando
 * no hay fecha: sin fecha no podemos afirmar que el precio esté vigente.
 */
export function freshnessFor(sku, { now = Date.now(), staleMs = STALE_MS } = {}) {
  const capturedAt = capturedAtOf(sku);
  if (!capturedAt || !Number.isFinite(now)) {
    return {
      capturedAt: null,
      ageMs: null,
      stale: true,
      tone: 'neutral',
      label: 'Sin fecha de actualización',
      shortLabel: 'Sin fecha',
    };
  }
  const ageMs = Math.max(0, now - Date.parse(capturedAt));
  const stale = ageMs > staleMs;
  const age = humanAge(ageMs);
  return {
    capturedAt,
    ageMs,
    stale,
    tone: stale ? 'warning' : 'ok',
    label: stale ? 'Precio desactualizado' : `Actualizado ${age}`,
    shortLabel: stale ? 'Desactualizado' : age,
  };
}

/** Sólo una oferta verificada y fresca puede entrar en el "mejor precio". */
export function isVerifiedFresh(sku, options = {}) {
  if (!sku || sku.status !== 'verified') return false;
  const fresh = freshnessFor(sku, options);
  return !fresh.stale && !!fresh.capturedAt;
}

/** Etiqueta obligatoria cuando el precio sí está verificado. */
export function verifiedPriceLabel(sku, options = {}) {
  if (!isVerifiedFresh(sku, options)) return '';
  return `Precio verificado el ${shortDate(capturedAtOf(sku))}`;
}
