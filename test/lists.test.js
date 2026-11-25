import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addListItem,
  clearPurchasedItems,
  createList,
  deleteList,
  ensureList,
  listSummary,
  removeListItem,
  renameList,
  selectList,
  updateListItem,
} from '../src/lists.js';

function freshState() {
  return { lists: [], activeListId: null };
}

test('crear, seleccionar, renombrar y borrar listas named', () => {
  const state = freshState();
  const weekly = createList(state, '  Semanal  ', { id: 'l1', now: 1000 });
  const party = createList(state, 'Fiesta', { id: 'l2', now: 2000 });
  assert.equal(weekly.name, 'Semanal');
  assert.equal(state.activeListId, 'l2');
  assert.equal(selectList(state, 'l1'), true);
  assert.equal(state.activeListId, 'l1');
  assert.equal(renameList(state, 'l1', '  Semanal grande '), true);
  assert.equal(weekly.name, 'Semanal grande');
  assert.equal(selectList(state, 'inexistente'), false);
  assert.equal(deleteList(state, 'l2'), true);
  assert.equal(state.lists.length, 1);
  assert.equal(state.activeListId, 'l1');
  assert.equal(party.items.length, 0);
});

test('ensureList crea una lista por defecto sin productos inventados', () => {
  const state = freshState();
  const list = ensureList(state, { id: 'default', now: 3000 });
  assert.equal(list.name, 'Semanal');
  assert.deepEqual(list.items, []);
  assert.equal(ensureList(state).id, 'default');
  assert.equal(state.lists.length, 1);
});

test('agregar Items deduce cantidades y conserva notas; límites y saneado', () => {
  const state = freshState();
  const list = createList(state, 'Semanal', { id: 'l1', now: 1000 });
  const first = addListItem(
    state,
    { productId: 'leche', qty: 2, notes: '  sin azúcar  ' },
    { now: 1000 }
  );
  assert.equal(first.qty, 2);
  assert.equal(first.notes, 'sin azúcar');
  assert.equal(first.purchased, false);
  const same = addListItem(
    state,
    { productId: 'leche', qty: 3, notes: '' },
    { listId: 'l1', now: 2000 }
  );
  assert.equal(same, first);
  assert.equal(first.qty, 5);
  assert.equal(first.notes, 'sin azúcar');
  assert.equal(state.lists[0].items.length, 1);

  assert.equal(addListItem(state, { productId: 'arroz', qty: 500 }, { now: 2000 }).qty, 99);
  assert.equal(addListItem(state, { productId: '', qty: 1 }), null);
  assert.equal(updateListItem(state, 'l1', 'leche', { qty: 0, purchased: true }), true);
  assert.equal(first.qty, 1);
  assert.equal(first.purchased, true);
  assert.deepEqual(listSummary(list), { products: 2, units: 100, purchased: 1, pending: 1 });
  assert.equal(clearPurchasedItems(state, 'l1'), 1);
  assert.equal(list.items.length, 1);
  assert.equal(removeListItem(state, 'l1', 'arroz'), true);
  assert.equal(removeListItem(state, 'l1', 'arroz'), false);
});
