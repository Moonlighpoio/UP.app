/**
 * UP · Búsquedas recientes, populares y analítica asociada (FASE U2).
 * Todo en localStorage del navegador, sin identificadores personales.
 */
import { MAX_RECENT_SEARCHES } from './suggest.js';
import { trackEvent } from './analytics.js';

export function recentSearches(state) {
  return Array.isArray(state.recentSearches)
    ? state.recentSearches.slice(0, MAX_RECENT_SEARCHES)
    : [];
}

export function addRecentSearch(state, raw) {
  const value = String(raw || '')
    .trim()
    .slice(0, 80);
  if (value.length < 2) return recentSearches(state);
  const rest = recentSearches(state).filter((item) => item.toLowerCase() !== value.toLowerCase());
  state.recentSearches = [value, ...rest].slice(0, MAX_RECENT_SEARCHES);
  return state.recentSearches;
}

export function clearRecentSearches(state) {
  state.recentSearches = [];
}

export function popularSearches(state, limit = 5) {
  const counts = new Map();
  for (const event of Array.isArray(state.analytics) ? state.analytics : []) {
    if (event.event !== 'search') continue;
    const query = String(event.props?.query || '').trim();
    if (query.length >= 2) counts.set(query, (counts.get(query) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
    .slice(0, limit)
    .map(([query]) => query);
}

const lastRecorded = new Map();

/** Registra búsqueda y, si no hay resultados, el evento que alimenta la analítica. */
export function recordSearch(state, query, resultCount, { now = Date.now(), force = false } = {}) {
  const value = String(query || '')
    .trim()
    .slice(0, 80);
  if (value.length < 2) return null;
  const key = `${value}|${resultCount > 0 ? 'ok' : 'zero'}`;
  const previous = lastRecorded.get(key) || 0;
  if (!force && now - previous < 1500) return null;
  lastRecorded.set(key, now);

  addRecentSearch(state, value);
  trackEvent(state, 'search', { query: value, results: resultCount }, { now });
  if (resultCount === 0) {
    trackEvent(state, 'search_no_results', { query: value }, { now });
  }
  return value;
}
