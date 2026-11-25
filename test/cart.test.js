import test from 'node:test';
import assert from 'node:assert/strict';
import { state, setCatalog } from '../src/state.js';
import {
  clearCartItems,
  getUndoState,
  initCart,
  loadSavedCartItems,
  removeFromCart,
  undoLastCartChange,
  UNDO_MS,
  updateCartQty,
} from '../src/cart.js';

function seedCart() {
  setCatalog(
    [
      { id: 'a', name: 'A', category: 'TODOS', prices: { lider: 1000 } },
      { id: 'b', name: 'B', category: 'TODOS', prices: { jumbo: 2000 } },
    ],
    ['TODOS']
  );
  state.cart = [{ key: 'a_lider', productId: 'a', storeId: 'lider', qty: 2 }];
}

test('el deshacer dura 5 segundos y restaura una eliminación', () => {
  assert.equal(UNDO_MS, 5000);
  seedCart();
  let avisos = 0;
  initCart({ notifyUndo: () => (avisos += 1), render: () => {} });
  removeFromCart('a_lider');
  assert.equal(state.cart.length, 0);
  assert.equal(avisos, 1);
  assert.equal(getUndoState().label, 'Producto eliminado');

  assert.equal(undoLastCartChange(), true);
  assert.equal(state.cart[0].qty, 2);
  assert.equal(getUndoState(), null);
  assert.equal(undoLastCartChange(), false);
});

test('vaciar el carrito también se puede deshacer', () => {
  seedCart();
  initCart({ notifyUndo: () => {}, render: () => {} });
  clearCartItems();
  assert.equal(state.cart.length, 0);
  assert.equal(getUndoState().label, 'Carrito vaciado');
  undoLastCartChange();
  assert.equal(state.cart.length, 1);
});

test('bajar la cantidad a cero elimina con deshacer', () => {
  seedCart();
  initCart({ notifyUndo: () => {}, render: () => {} });
  updateCartQty('a_lider', -2);
  assert.equal(state.cart.length, 0);
  assert.equal(getUndoState().label, 'Producto eliminado');
  undoLastCartChange();
  assert.equal(state.cart[0].qty, 2);
});

test('cargar un carrito guardado fusiona cadenas y límites sin perder el original', () => {
  seedCart();
  initCart({ notifyUndo: () => {}, render: () => {} });
  const loaded = loadSavedCartItems([
    { productId: 'a', storeId: 'lider', qty: 2 },
    { productId: 'b', storeId: 'jumbo', qty: 3 },
    { productId: 'inexistente', storeId: 'lider', qty: 1 },
  ]);
  assert.equal(loaded, 2);
  assert.equal(state.cart.length, 2);
  assert.equal(state.cart.find((item) => item.key === 'a_lider').qty, 4);
  assert.equal(state.cart.find((item) => item.key === 'b_jumbo').qty, 3);
  assert.equal(getUndoState().label, 'Carrito guardado cargado');

  undoLastCartChange();
  assert.equal(state.cart.length, 1);
  assert.equal(state.cart[0].qty, 2);
});
