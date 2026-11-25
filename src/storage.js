/**
 * UP · Estado persistente de prueba (FASE A).
 * Una sola clave versionada, en localStorage del navegador. Toda lectura y
 * escritura está envuelta en try/catch: si el dato está corrupto se reinicia
 * de forma segura. Nunca se envía nada a un servidor.
 */
import { createDemoOrders } from './demo-orders.js';
import { bankBenefitIds } from './demo-content.js';
import { REPORT_REASONS, REPORT_STATUSES } from './reports.js';
import { ANALYTICS_EVENTS } from './analytics.js';

export const STORAGE_KEY = 'up_state_v2';
export const STATE_VERSION = 2;

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

function defaultState() {
  return {
    version: STATE_VERSION,
    cart: [],
    users: [],
    session: null,
    orders: createDemoOrders(),
    tracking: {},
    addresses: [],
    favoriteBenefits: [],
    profile: null,
    reports: [],
    analytics: [],
    audit: [],
    overrides: {},
    flags: {},
    settings: {
      staleDays: 7,
      outlierPct: 40,
      maxReportsPerHour: 3,
      syncLimit: 50,
      noticeVersion: 1,
    },
    recentSearches: [],
    lists: [],
    activeListId: null,
    favorites: [],
    alerts: [],
    notifications: [],
    preferences: null,
    surveys: [],
    jobs: [],
  };
}

function sanitizeCart(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .filter((item) => {
      if (!isObject(item)) return false;
      if (typeof item.productId !== 'string' || typeof item.storeId !== 'string') return false;
      const qty = Number(item.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) return false;
      const key = `${item.productId}_${item.storeId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => ({
      key: `${item.productId}_${item.storeId}`,
      productId: item.productId,
      storeId: item.storeId,
      qty: Number(item.qty),
    }));
}

function sanitizeUsers(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((user) => {
      if (!isObject(user) || typeof user.email !== 'string') return false;
      const hash = user.passwordHash;
      return (
        typeof user.id === 'string' &&
        typeof user.name === 'string' &&
        isObject(hash) &&
        typeof hash.salt === 'string' &&
        typeof hash.hash === 'string' &&
        Number.isInteger(hash.iterations) &&
        hash.iterations > 0
      );
    })
    .map((user) => ({
      ...user,
      role: user.role === 'admin' ? 'admin' : 'viewer',
      active: user.active !== false,
    }));
}

function sanitizeSession(value, users) {
  if (!isObject(value)) return null;
  if (typeof value.token !== 'string' || typeof value.userId !== 'string') return null;
  if (!users.some((user) => user.id === value.userId)) return null;
  if (typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)))
    return null;
  return {
    token: value.token,
    userId: value.userId,
    createdAt: value.createdAt || null,
    expiresAt: value.expiresAt,
  };
}

function sanitizeOrders(value) {
  if (!Array.isArray(value)) return createDemoOrders();
  const clean = value.filter(
    (order) => isObject(order) && typeof order.id === 'string' && Array.isArray(order.storeGroups)
  );
  // Si no quedó ningún pedido (ni siquiera los ejemplos), se reaprovisiona.
  return clean.length ? clean : createDemoOrders();
}

function sanitizeTracking(value) {
  if (!isObject(value)) return {};
  const clean = {};
  for (const [id, item] of Object.entries(value)) {
    if (
      typeof id === 'string' &&
      isObject(item) &&
      Number.isFinite(Number(item.startedAt)) &&
      item.isDemo === true
    ) {
      clean[id] = { startedAt: Number(item.startedAt), isDemo: true };
    }
  }
  return clean;
}

function sanitizeAddresses(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (address) =>
      isObject(address) &&
      typeof address.id === 'string' &&
      typeof address.commune === 'string' &&
      typeof address.street === 'string'
  );
}

function sanitizeFavoriteBenefits(value) {
  if (!Array.isArray(value)) return [];
  const known = new Set(bankBenefitIds());
  return [...new Set(value.filter((id) => typeof id === 'string' && known.has(id)))];
}

function sanitizeReports(value) {
  if (!Array.isArray(value)) return [];
  const reasons = new Set(REPORT_REASONS.map((item) => item.value));
  const statuses = new Set(REPORT_STATUSES);
  return value
    .filter(
      (item) =>
        isObject(item) &&
        typeof item.id === 'string' &&
        typeof item.productId === 'string' &&
        typeof item.chain === 'string' &&
        reasons.has(item.reason) &&
        statuses.has(item.status) &&
        Number.isFinite(Date.parse(item.createdAt))
    )
    .slice(-500)
    .map((item) => ({
      ...item,
      comment: String(item.comment || '').slice(0, 500),
      userId: typeof item.userId === 'string' ? item.userId : null,
      resolvedBy: typeof item.resolvedBy === 'string' ? item.resolvedBy : null,
      resolvedAt: Number.isFinite(Date.parse(item.resolvedAt)) ? item.resolvedAt : null,
    }));
}

function sanitizeEvents(value, allowed) {
  if (!Array.isArray(value)) return [];
  const names = new Set(allowed);
  return value
    .filter(
      (item) => isObject(item) && names.has(item.event) && Number.isFinite(Date.parse(item.at))
    )
    .slice(-1000)
    .map((item) => ({ ...item, props: isObject(item.props) ? item.props : {} }));
}

function sanitizeAudit(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item) =>
        isObject(item) && typeof item.action === 'string' && Number.isFinite(Date.parse(item.at))
    )
    .slice(-500);
}

function sanitizeOverrides(value) {
  if (!isObject(value)) return {};
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (isObject(item) && item.status === 'pending' && Number.isFinite(Date.parse(item.at))) {
      out[key] = {
        status: 'pending',
        at: item.at,
        reportId: typeof item.reportId === 'string' ? item.reportId : null,
      };
    }
  }
  return out;
}

function sanitizeFlags(value) {
  if (!isObject(value)) return {};
  const out = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (/^[a-z0-9-]+$/.test(key)) out[key] = enabled === true;
  }
  return out;
}

function sanitizeSettings(value) {
  const base = defaultState().settings;
  if (!isObject(value)) return base;
  const positive = (input, fallback, min, max) => {
    const n = Number(input);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    ...base,
    staleDays: positive(value.staleDays, base.staleDays, 1, 365),
    outlierPct: positive(value.outlierPct, base.outlierPct, 5, 95),
    maxReportsPerHour: Math.round(positive(value.maxReportsPerHour, base.maxReportsPerHour, 1, 20)),
    syncLimit: Math.round(positive(value.syncLimit, base.syncLimit, 1, 500)),
    noticeVersion: Math.round(positive(value.noticeVersion, base.noticeVersion, 1, 999)),
  };
}

function sanitizeRecentSearches(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((item) => typeof item === 'string').map((item) => item.trim().slice(0, 80))
    ),
  ].slice(0, 8);
}

function sanitizeLists(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (list) => isObject(list) && typeof list.id === 'string' && typeof list.name === 'string'
    )
    .slice(0, 12)
    .map((list) => ({
      ...list,
      name: list.name.trim().slice(0, 60),
      createdAt: Number.isFinite(Date.parse(list.createdAt))
        ? new Date(list.createdAt).toISOString()
        : null,
      items: Array.isArray(list.items)
        ? list.items
            .filter((item) => isObject(item) && typeof item.productId === 'string')
            .slice(0, 100)
            .map((item) => {
              const qty = Number(item.qty);
              return {
                id: typeof item.id === 'string' ? item.id : null,
                productId: item.productId,
                qty: Number.isInteger(qty) && qty >= 1 && qty <= 99 ? qty : 1,
                notes: typeof item.notes === 'string' ? item.notes.slice(0, 160) : '',
                purchased: item.purchased === true,
                addedAt: Number.isFinite(Date.parse(item.addedAt))
                  ? new Date(item.addedAt).toISOString()
                  : null,
              };
            })
        : [],
    }));
}

function sanitizeFavorites(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => typeof id === 'string'))].slice(0, 300);
}

function sanitizeAlerts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (alert) =>
        isObject(alert) &&
        typeof alert.id === 'string' &&
        typeof alert.productId === 'string' &&
        typeof alert.chain === 'string' &&
        Number.isFinite(alert.targetPrice)
    )
    .slice(-300);
}

function sanitizeNotifications(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item) =>
        isObject(item) && typeof item.id === 'string' && Number.isFinite(Date.parse(item.at))
    )
    .slice(-100);
}

function sanitizePreferences(value) {
  if (!isObject(value)) return null;
  return {
    commune: typeof value.commune === 'string' ? value.commune.slice(0, 80) : '',
    chains: Array.isArray(value.chains) ? value.chains.filter((id) => typeof id === 'string') : [],
    delivery: value.delivery === 'retiro' ? 'retiro' : 'despacho',
    onboarded: value.onboarded === true,
  };
}

function sanitizeSurveys(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => isObject(item) && Number.isFinite(Date.parse(item.at))).slice(-200);
}

function sanitizeJobs(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => isObject(item) && typeof item.id === 'string').slice(-100);
}

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Lee y valida. Los campos ausentes vuelven a su valor por defecto. */
export function loadState() {
  const fallback = defaultState();
  const store = storage();
  if (!store) return fallback;

  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) {
      store.setItem(STORAGE_KEY, JSON.stringify(fallback));
      return fallback;
    }
    const parsed = JSON.parse(raw);
    if (!isObject(parsed) || parsed.version !== STATE_VERSION) {
      store.setItem(STORAGE_KEY, JSON.stringify(fallback));
      return fallback;
    }
    const users = sanitizeUsers(parsed.users);
    return {
      version: STATE_VERSION,
      cart: sanitizeCart(parsed.cart),
      users,
      session: sanitizeSession(parsed.session, users),
      orders: sanitizeOrders(parsed.orders),
      tracking: sanitizeTracking(parsed.tracking),
      addresses: sanitizeAddresses(parsed.addresses),
      favoriteBenefits: sanitizeFavoriteBenefits(parsed.favoriteBenefits),
      profile: isObject(parsed.profile) ? parsed.profile : null,
      reports: sanitizeReports(parsed.reports),
      analytics: sanitizeEvents(parsed.analytics, ANALYTICS_EVENTS),
      audit: sanitizeAudit(parsed.audit),
      overrides: sanitizeOverrides(parsed.overrides),
      flags: sanitizeFlags(parsed.flags),
      settings: sanitizeSettings(parsed.settings),
      recentSearches: sanitizeRecentSearches(parsed.recentSearches),
      lists: sanitizeLists(parsed.lists),
      activeListId:
        typeof parsed.activeListId === 'string' &&
        sanitizeLists(parsed.lists).some((list) => list.id === parsed.activeListId)
          ? parsed.activeListId
          : null,
      favorites: sanitizeFavorites(parsed.favorites),
      alerts: sanitizeAlerts(parsed.alerts),
      notifications: sanitizeNotifications(parsed.notifications),
      preferences: sanitizePreferences(parsed.preferences),
      surveys: sanitizeSurveys(parsed.surveys),
      jobs: sanitizeJobs(parsed.jobs),
    };
  } catch {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(fallback));
    } catch {
      // Sin almacenamiento disponible: la sesión sigue funcionando en memoria.
    }
    return fallback;
  }
}

/** Escribe el estado completo. Devuelve false si el navegador lo bloquea. */
export function saveState(state) {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: STATE_VERSION }));
    return true;
  } catch {
    return false;
  }
}

/** Aplica un mutador sobre una copia recién leída y guarda el resultado. */
export function updateState(mutator) {
  const state = loadState();
  const result = mutator(state);
  saveState(state);
  return result === undefined ? state : result;
}

/** Variante asíncrona para mutadores que derivan claves (PBKDF2). */
export async function updateStateAsync(mutator) {
  const state = loadState();
  const result = await mutator(state);
  saveState(state);
  return result === undefined ? state : result;
}

/** Borra exclusivamente datos personales de prueba; conserva los pedidos "Ejemplo". */
export function clearPersonalData() {
  return updateState((state) => {
    state.users = [];
    state.session = null;
    state.orders = state.orders.filter((order) => order.isDemo === true);
    state.tracking = {};
    state.addresses = [];
    state.favoriteBenefits = [];
    state.profile = null;
    state.reports = (state.reports || []).map((report) => ({ ...report, userId: null }));
    state.recentSearches = [];
    state.audit = (state.audit || []).map((entry) => ({ ...entry, who: 'anonimo' }));
    state.lists = [];
    state.activeListId = null;
    state.favorites = [];
    state.alerts = [];
    state.notifications = [];
    state.preferences = null;
    state.surveys = [];
  });
}

/** Persiste el carrito en memoria de src/state.js sin cambiar su lógica. */
export function saveCart(cart) {
  return updateState((state) => {
    state.cart = sanitizeCart(cart);
  });
}
