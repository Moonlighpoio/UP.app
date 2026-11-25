/**
 * UP · Diálogo rápido "Agregar a mi lista" (FASE U3).
 * Se abre desde cualquier tarjeta y permite elegir lista, cantidad y nota.
 */
import { $, esc } from './utils.js';
import { getProduct } from './state.js';
import { loadState, updateState } from './storage.js';
import { trackEvent } from './analytics.js';
import { addListItem, ensureList, MAX_LIST_QTY } from './lists.js';
import { closeDialog, openDialog } from './a11y.js';

let bound = false;
let notify = () => {};
let productId = null;

function dialog() {
  return $('list-add-modal');
}

function setError(message) {
  const el = $('list-add-error');
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
}

function options(saved, selectedId) {
  return (saved.lists || [])
    .map(
      (list) =>
        `<option value="${esc(list.id)}"${list.id === selectedId ? ' selected' : ''}>${esc(list.name)}</option>`
    )
    .join('');
}

export function initListUI(hooks = {}) {
  notify = hooks.notify || notify;
  if (bound) return;
  bound = true;

  $('close-list-add-modal').addEventListener('click', () => closeListDialog());
  $('cancel-list-add-btn').addEventListener('click', () => closeListDialog());
  dialog().addEventListener('click', (event) => {
    if (event.target === dialog()) closeListDialog();
  });

  $('list-add-form').addEventListener('submit', (event) => {
    event.preventDefault();
    setError('');
    const form = event.currentTarget;
    const qty = Number(form.elements.qty.value);
    if (!productId || !Number.isInteger(qty) || qty < 1 || qty > MAX_LIST_QTY) {
      setError('Elige una cantidad entre 1 y 99.');
      return;
    }
    const listId = form.elements.listId.value;
    const added = updateState((state) =>
      addListItem(state, { productId, qty, notes: form.elements.notes.value }, { listId })
    );
    if (!added) {
      setError('No se pudo agregar: revisa el límite de productos de la lista.');
      return;
    }
    closeListDialog();
    form.reset();
    notify('PRODUCTO AGREGADO A MI LISTA · MODO PRUEBA');
  });
}

export function openListDialog(nextProductId, qty = 1) {
  const product = getProduct(nextProductId);
  if (!product || !dialog()) return;
  const list = updateState((state) => {
    const hadLists = Array.isArray(state.lists) && state.lists.length > 0;
    const created = ensureList(state);
    if (!hadLists && created) trackEvent(state, 'list_created', { listId: created.id });
    return created;
  });
  productId = nextProductId;
  $('list-add-product-name').textContent = product.name;
  $('list-add-list').innerHTML = options(loadState(), list?.id);
  const safeQty = Math.min(MAX_LIST_QTY, Math.max(1, Math.round(Number(qty) || 1)));
  $('list-add-qty').value = safeQty;
  $('list-add-notes').value = '';
  setError('');
  openDialog(dialog(), 'list-add-qty');
}

export function closeListDialog() {
  if (dialog() && !dialog().classList.contains('hidden')) closeDialog(dialog());
}
