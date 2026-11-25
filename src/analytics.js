/**
 * UP · Analítica interna sin datos personales (FASE U7, base en U1).
 * Sólo eventos locales en localStorage: ni correos, ni nombres, ni IDs de usuario.
 */
export const ANALYTICS_EVENTS = Object.freeze([
  'search',
  'search_no_results',
  'view_product',
  'add_to_cart',
  'click_store_link',
  'report_price',
  'checkout_start',
  'checkout_complete',
  'alert_created',
  'list_created',
  'flag_changed',
]);

const MAX_EVENTS = 1000;

function cleanProps(props) {
  const out = {};
  for (const [key, value] of Object.entries(props || {})) {
    if (['email', 'name', 'userId', 'password', 'token'].includes(key)) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 120);
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

export function trackEvent(state, event, props = {}, { now = Date.now() } = {}) {
  if (!ANALYTICS_EVENTS.includes(event)) return null;
  const item = {
    id: `ev_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    event,
    at: new Date(now).toISOString(),
    props: cleanProps(props),
  };
  state.analytics = [...(Array.isArray(state.analytics) ? state.analytics : []), item].slice(
    -MAX_EVENTS
  );
  return item;
}
