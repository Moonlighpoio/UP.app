/**
 * UP · Listas de compra persistentes (FASE U3).
 * Funciones puras sobre el estado ya versionado: no leen localStorage ni DOM.
 * Las listas son datos personales locales; `clearPersonalData()` ya las borra.
 */

export const DEFAULT_LIST_NAMES = Object.freeze(['Semanal', 'Fiesta']);
export const MAX_LISTS = 12;
export const MAX_LIST_ITEMS = 100;
export const MAX_LIST_NAME = 60;
export const MAX_LIST_NOTES = 160;
export const MAX_LIST_QTY = 99;

function cleanText(value, max) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max);
}

export function makeListId(now = Date.now(), random = Math.random()) {
  return `list_${now.toString(36)}_${random.toString(36).slice(2, 8)}`;
}

export function listsOf(state) {
  return Array.isArray(state?.lists) ? state.lists : [];
}

export function getList(state, id) {
  return listsOf(state).find((list) => list.id === id) || null;
}

export function activeList(state) {
  return getList(state, state?.activeListId) || listsOf(state)[0] || null;
}

/** Asegura una lista para los atajos rápidos sin crear datos de producto. */
export function ensureList(state, options = {}) {
  const current = activeList(state);
  if (current) return current;
  return createList(state, options.name || DEFAULT_LIST_NAMES[0], options);
}

export function createList(state, name, options = {}) {
  const cleanName = cleanText(name, MAX_LIST_NAME);
  if (!cleanName) return null;
  if (listsOf(state).length >= MAX_LISTS) return null;
  if (!Array.isArray(state.lists)) state.lists = [];
  const list = {
    id: options.id || makeListId(options.now, options.random),
    name: cleanName,
    createdAt: new Date(options.now ?? Date.now()).toISOString(),
    items: [],
  };
  state.lists.push(list);
  state.activeListId = list.id;
  return list;
}

export function selectList(state, id) {
  if (!getList(state, id)) return false;
  state.activeListId = id;
  return true;
}

export function renameList(state, id, name) {
  const list = getList(state, id);
  const cleanName = cleanText(name, MAX_LIST_NAME);
  if (!list || !cleanName) return false;
  list.name = cleanName;
  return true;
}

export function deleteList(state, id) {
  if (!Array.isArray(state.lists)) return false;
  const before = state.lists.length;
  state.lists = state.lists.filter((list) => list.id !== id);
  if (state.lists.length === before) return false;
  if (state.activeListId === id) state.activeListId = state.lists[0]?.id || null;
  return true;
}

function validProductId(productId) {
  return typeof productId === 'string' && productId.trim().length > 0;
}

function normalizedQty(value, fallback = 1) {
  const qty = Number(value);
  if (!Number.isFinite(qty)) return fallback;
  return Math.min(MAX_LIST_QTY, Math.max(1, Math.round(qty)));
}

export function addListItem(state, input = {}, options = {}) {
  const list = options.listId ? getList(state, options.listId) : ensureList(state, options);
  if (!list || !validProductId(input.productId)) return null;
  if (!Array.isArray(list.items)) list.items = [];
  const productId = input.productId.trim();
  const notes = cleanText(input.notes, MAX_LIST_NOTES);
  const existing = list.items.find((item) => item.productId === productId);
  if (existing) {
    existing.qty = normalizedQty(existing.qty + normalizedQty(input.qty), existing.qty);
    if (notes) existing.notes = notes;
    return existing;
  }
  if (list.items.length >= MAX_LIST_ITEMS) return null;
  const item = {
    id: `item_${(options.now ?? Date.now()).toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    productId,
    qty: normalizedQty(input.qty),
    notes,
    purchased: false,
    addedAt: new Date(options.now ?? Date.now()).toISOString(),
  };
  list.items.push(item);
  return item;
}

export function updateListItem(state, listId, productId, patch = {}) {
  const list = getList(state, listId);
  const item = list?.items?.find((entry) => entry.productId === productId);
  if (!item) return false;
  if (patch.qty !== undefined) item.qty = normalizedQty(patch.qty, item.qty);
  if (patch.notes !== undefined) item.notes = cleanText(patch.notes, MAX_LIST_NOTES);
  if (patch.purchased !== undefined) item.purchased = patch.purchased === true;
  return true;
}

export function removeListItem(state, listId, productId) {
  const list = getList(state, listId);
  if (!list || !Array.isArray(list.items)) return false;
  const before = list.items.length;
  list.items = list.items.filter((item) => item.productId !== productId);
  return list.items.length !== before;
}

export function clearPurchasedItems(state, listId) {
  const list = getList(state, listId);
  if (!list || !Array.isArray(list.items)) return 0;
  const before = list.items.length;
  list.items = list.items.filter((item) => item.purchased !== true);
  return before - list.items.length;
}

export function listSummary(list) {
  const items = Array.isArray(list?.items) ? list.items : [];
  const purchased = items.filter((item) => item.purchased === true).length;
  return {
    products: items.length,
    units: items.reduce((sum, item) => sum + normalizedQty(item.qty), 0),
    purchased,
    pending: items.length - purchased,
  };
}
