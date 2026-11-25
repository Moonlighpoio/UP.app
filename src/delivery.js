/**
 * UP · Entrega simulada, direcciones locales y retiro (FASE U5).
 * Funciones puras: las comunas son nombres reales de la RM; nunca inventan
 * sucursales, disponibilidad ni despacho real.
 */
import { STORES } from './config.js';

export const RM_COMMUNES = Object.freeze([
  'Cerrillos',
  'Cerro Navia',
  'Conchalí',
  'El Bosque',
  'Estación Central',
  'Huechuraba',
  'Independencia',
  'La Florida',
  'La Granja',
  'La Pintana',
  'La Reina',
  'Las Condes',
  'Lo Espejo',
  'Lo Prado',
  'Macul',
  'Maipú',
  'Ñuñoa',
  'Pedro Aguirre Cerda',
  'Peñalolén',
  'Providencia',
  'Pudahuel',
  'Quilicura',
  'Quinta Normal',
  'Recoleta',
  'Renca',
  'Santiago',
  'San Bernardo',
  'San Joaquín',
  'San Miguel',
  'San Ramón',
  'Vitacura',
]);

export function foldText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function communeSuggestions({ query = '', addresses = [], commune = '', limit = 8 } = {}) {
  const saved = Array.isArray(addresses)
    ? addresses.map((address) => address?.commune).filter((value) => typeof value === 'string')
    : [];
  const all = [...new Set([...RM_COMMUNES, ...saved, ...(commune ? [commune] : [])])];
  const needle = foldText(query);
  const matches = needle ? all.filter((value) => foldText(value).includes(needle)) : all.slice();
  return matches
    .sort((a, b) => {
      if (!needle) return a.localeCompare(b, 'es');
      const aStarts = foldText(a).startsWith(needle) ? 0 : 1;
      const bStarts = foldText(b).startsWith(needle) ? 0 : 1;
      return aStarts - bStarts || a.localeCompare(b, 'es');
    })
    .slice(0, Math.max(1, Math.min(50, limit)));
}

/**
 * Interpreta una entrada libre tipo "Av. Providencia 1234, Providencia".
 * La comuna se reconoce por coincidencia aproximada sin distinción de tildes;
 * el resto se conserva como calle. Nunca valida existencia real de la dirección.
 */
export function parseAddressInput(value = '', { addresses = [] } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return { street: '', commune: '' };
  const known = communeSuggestions({ addresses, limit: 50 });
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const streetParts = [];
  let commune = '';

  parts.forEach((part) => {
    const match = known.find((item) => foldText(part).includes(foldText(item)));
    if (match && !commune) commune = match;
    if (!match || foldText(part) !== foldText(match)) streetParts.push(part);
  });

  return { street: streetParts.join(', ').trim(), commune };
}

export function validateDeliveryAddress({
  street = '',
  commune = '',
  mode = 'domicilio',
  addresses = [],
} = {}) {
  const errors = {};
  const known = communeSuggestions({ addresses, limit: 50 }).some(
    (value) => foldText(value) === foldText(commune)
  );
  if (mode === 'domicilio') {
    if (String(street).trim().length < 4)
      errors.street = 'Ingresa una calle y número (mínimo 4 caracteres).';
    if (!known || !String(commune).trim()) errors.commune = 'Elige una comuna de la lista.';
  } else if (!known || !String(commune).trim()) {
    errors.commune = 'Elige una comuna para buscar la sucursal más cercana.';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

function slotSeed(storeId, mode) {
  return foldText(`${storeId}|${mode}`)
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

/** Franjas ilustrativas derivadas del plazo declarado, no disponibilidad real. */
export function slotsFor(storeId, mode = 'domicilio', stores = STORES) {
  const store = stores[storeId];
  if (!store) return [];
  const hours = Number(store.deliveryHours) || 24;
  const seed = slotSeed(storeId, mode);
  const start = mode === 'retiro' ? 10 + (seed % 3) : 9 + (seed % 4);
  const span = Math.max(2, Math.min(6, Math.round(hours / 6)));
  return [0, 1, 2].map((index) => {
    const from = start + index * span;
    const to = from + span;
    return {
      id: `${mode}-${index}`,
      label: `${String(from).padStart(2, '0')}:00–${String(to).padStart(2, '0')}:00`,
      minutes: hours * 60,
    };
  });
}

export function nearestStoreFor({ storesData = [], commune = '', chain = '' } = {}) {
  const needle = foldText(commune);
  return (
    storesData
      .filter(
        (store) =>
          store &&
          (!needle || foldText(store.comuna) === needle) &&
          (!chain || store.chain === chain)
      )
      .sort((a, b) => Number(a.distanceKm) - Number(b.distanceKm))[0] || null
  );
}

/** El retiro no cobra despacho; no modifica los totales usados por los filtros. */
export function withPickupTotals(totals) {
  if (!totals) return totals;
  return {
    ...totals,
    storeGroups: totals.storeGroups.map((group) => ({
      ...group,
      shipping: 0,
      isFreeShipping: true,
      missingForFree: 0,
      progressPct: 100,
    })),
    totalShipping: 0,
    grandTotal: totals.productsSubtotal,
  };
}
