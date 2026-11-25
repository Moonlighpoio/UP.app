/**
 * UP · Feature flags locales (FASE U7, base para el panel P2).
 * Una desactivada desaparece de la interfaz sin lanzar errores. El cambio se
 * registra en analítica sin datos personales y en el estado local.
 */
import { ANALYTICS_EVENTS, trackEvent } from './analytics.js';

export const FEATURES = Object.freeze([
  { id: 'catalogo', label: 'Catálogo y filtros', route: '#/' },
  { id: 'detalle', label: 'Detalle de producto', route: '#/' },
  { id: 'comparador', label: 'Comparador', route: '#/comparar' },
  { id: 'carrito', label: 'Carrito por cadena', route: '#/' },
  { id: 'checkout', label: 'Checkout simulado', route: '#/' },
  { id: 'sesion', label: 'Sesión local', route: '#/login' },
  { id: 'cuenta', label: 'Mi cuenta', route: '#/cuenta' },
  { id: 'pedidos', label: 'Pedidos y seguimiento', route: '#/cuenta/pedidos' },
  { id: 'tiendas', label: 'Mapa de tiendas', route: '#/tiendas' },
  { id: 'ofertas', label: 'Ofertas y eventos', route: '#/ofertas' },
  { id: 'tarjetas', label: 'Beneficios bancarios', route: '#/tarjetas' },
  { id: 'favoritos', label: 'Favoritos', route: '#/cuenta/favoritos' },
  { id: 'lista', label: 'Lista y optimizador', route: '#/lista' },
  { id: 'alertas', label: 'Alertas de precio', route: '#/cuenta' },
  { id: 'reportes', label: 'Reportes de precios', route: '#/ayuda' },
  { id: 'onboarding', label: 'Onboarding', route: '#/cuenta' },
  { id: 'pwa', label: 'PWA y sin conexión', route: '#/ayuda' },
  { id: 'transiciones', label: 'Transiciones', route: '#/' },
]);

const ids = new Set(FEATURES.map((feature) => feature.id));

export function normalizeFlags(value) {
  const out = {};
  for (const feature of FEATURES) out[feature.id] = true;
  if (value && typeof value === 'object') {
    for (const [key, enabled] of Object.entries(value)) {
      if (ids.has(key)) out[key] = enabled === true;
    }
  }
  return out;
}

export function isFeatureEnabled(flags, id) {
  return normalizeFlags(flags)[id] === true;
}

/** Devuelve el estado mutado y registra el cambio con el nombre de la flag. */
export function setFlag(state, id, enabled) {
  if (!ids.has(id) || typeof enabled !== 'boolean') return false;
  state.flags = { ...normalizeFlags(state.flags), [id]: enabled };
  trackEvent(state, 'flag_changed', { featureId: id, enabled });
  return true;
}

export function visibleRoutes(flags) {
  const clean = normalizeFlags(flags);
  return FEATURES.filter((feature) => clean[feature.id]);
}

export { ANALYTICS_EVENTS };
