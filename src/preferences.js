/**
 * UP · Preferencias locales de primera visita (FASE U6).
 * Funciones puras: la comuna y las cadenas se guardan sólo en este navegador
 * y nunca se envían a la analítica. No predicen gustos ni inventan datos.
 */
import { STORES } from './config.js';
import { foldText, RM_COMMUNES } from './delivery.js';

export const DELIVERY_MODES = Object.freeze(['despacho', 'retiro']);

export function normalizePreferences(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const inputCommune = typeof source.commune === 'string' ? foldText(source.commune) : '';
  const commune = RM_COMMUNES.find((item) => foldText(item) === inputCommune) || '';
  const chains = Array.isArray(source.chains)
    ? [...new Set(source.chains.filter((id) => Object.hasOwn(STORES, id)))].slice(0, 5)
    : [];
  return {
    commune,
    chains,
    delivery: DELIVERY_MODES.includes(source.delivery) ? source.delivery : 'despacho',
    onboarded: source.onboarded === true,
  };
}

/** Sólo se muestra el modal si no se completó ni se omitió nunca. */
export function shouldShowOnboarding(preferences) {
  return normalizePreferences(preferences).onboarded !== true;
}

/** Prioriza cadenas elegidas como desempate; nunca cambia un orden explícito. */
export function sortByPreferences(products = [], preferences = null) {
  const { chains } = normalizePreferences(preferences);
  if (!chains.length) return products.slice();
  return products
    .map((product, index) => ({
      product,
      index,
      score: chains.filter((chain) => Number.isFinite(product?.prices?.[chain])).length,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ product }) => product);
}

/** Las sucursales de cadena preferida aparecen primero, sin alterar distancias. */
export function sortStoresByPreferences(storesData = [], preferences = null) {
  const { chains } = normalizePreferences(preferences);
  if (!chains.length) return storesData.slice();
  return storesData
    .map((store, index) => ({ store, index }))
    .sort((a, b) => {
      const rank = (item) => (chains.includes(item.store?.chain) ? 0 : 1);
      return rank(a) - rank(b) || a.index - b.index;
    })
    .map(({ store }) => store);
}

/** Texto neutro para la cuenta: no expone ubicación exacta ni datos personales. */
export function preferenceSummary(preferences) {
  const clean = normalizePreferences(preferences);
  const chains = clean.chains.map((id) => STORES[id].name).join(', ');
  return [
    clean.commune ? `Comuna: ${clean.commune}` : 'Sin comuna elegida',
    chains ? `Cadenas: ${chains}` : 'Todas las cadenas',
    clean.delivery === 'retiro' ? 'Prefiere retiro' : 'Prefiere despacho',
  ].join(' · ');
}
