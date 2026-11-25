import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addSavedCart,
  findSavedCart,
  makeSavedCart,
  MAX_SAVED_CARTS,
  removeSavedCart,
} from '../src/saved-carts.js';

test('un carrito guardado normaliza nombre y cantidades', () => {
  const saved = makeSavedCart(
    {
      name: '  Semanal  ',
      items: [
        { productId: 'a', storeId: 'lider', qty: 0 },
        { productId: 'b', storeId: 'jumbo', qty: 500 },
      ],
    },
    { now: 1700000000000 }
  );
  assert.equal(saved.name, 'Semanal');
  assert.deepEqual(saved.items, [
    { key: 'a_lider', productId: 'a', storeId: 'lider', qty: 1 },
    { key: 'b_jumbo', productId: 'b', storeId: 'jumbo', qty: 99 },
  ]);
  assert.match(saved.id, /^save_/);
  assert.equal(saved.savedAt, new Date(1700000000000).toISOString());
});

test('no se guardan carritos vacíos ni sin nombre', () => {
  assert.equal(
    makeSavedCart({ name: '', items: [{ productId: 'a', storeId: 'lider', qty: 1 }] }),
    null
  );
  assert.equal(makeSavedCart({ name: 'Semanal', items: [] }), null);
});

test('la lista conserva un máximo y permite cargar y borrar por id', () => {
  let list = [];
  for (let index = 0; index < MAX_SAVED_CARTS + 3; index += 1) {
    list = addSavedCart(
      list,
      makeSavedCart({ name: `C${index}`, items: [{ productId: 'a', storeId: 'lider', qty: 1 }] })
    );
  }
  assert.equal(list.length, MAX_SAVED_CARTS);
  assert.equal(list[0].name, `C${MAX_SAVED_CARTS + 2}`);
  const id = list[0].id;
  assert.equal(findSavedCart(list, id).name, `C${MAX_SAVED_CARTS + 2}`);
  list = removeSavedCart(list, id);
  assert.equal(findSavedCart(list, id), null);
  assert.equal(list.length, MAX_SAVED_CARTS - 1);
});

test('el estado persistente sanitiza carritos guardados y los borra con los datos personales', async () => {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
  const { loadState, clearPersonalData, STORAGE_KEY, STATE_VERSION } =
    await import('../src/storage.js');
  data.set(
    STORAGE_KEY,
    JSON.stringify({
      version: STATE_VERSION,
      savedCarts: [
        {
          id: 'valido',
          name: 'Semanal',
          items: [{ productId: 'a', storeId: 'lider', qty: 2 }],
          savedAt: new Date().toISOString(),
        },
        { id: 'vacio', name: 'Sin productos', items: [] },
      ],
    })
  );
  const loaded = loadState();
  assert.equal(loaded.savedCarts.length, 1);
  assert.equal(loaded.savedCarts[0].items[0].qty, 2);

  clearPersonalData();
  assert.equal(loadState().savedCarts.length, 0);
  delete globalThis.localStorage;
});
