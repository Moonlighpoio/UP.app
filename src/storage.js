/**
 * UP · Estado persistente de prueba (FASE A).
 * Una sola clave versionada, en localStorage del navegador. Toda lectura y
 * escritura está envuelta en try/catch: si el dato está corrupto se reinicia
 * de forma segura. Nunca se envía nada a un servidor.
 */
import { createDemoOrders } from './demo-orders.js';
import { bankBenefitIds } from './demo-content.js';

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
  return value.filter((user) => {
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
  });
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
  });
}

/** Persiste el carrito en memoria de src/state.js sin cambiar su lógica. */
export function saveCart(cart) {
  return updateState((state) => {
    state.cart = sanitizeCart(cart);
  });
}
