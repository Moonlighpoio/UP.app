import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPersonalData,
  loadState,
  saveState,
  STORAGE_KEY,
  STATE_VERSION,
} from '../src/storage.js';

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
}

function withStorage(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
  try {
    run();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
}

test('un estado corrupto o de otra versión se reinicia sin lanzar', () => {
  withStorage(() => {
    globalThis.localStorage.setItem(STORAGE_KEY, '{ esto no es JSON');
    const recovered = loadState();
    assert.equal(recovered.version, STATE_VERSION);
    assert.equal(recovered.orders.length, 3);
    assert.equal(
      recovered.orders.every((order) => order.isDemo === true),
      true
    );

    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, cart: [] }));
    assert.equal(loadState().version, STATE_VERSION);
  });
});

test('el carrito se sanea y los datos personales se pueden borrar', () => {
  withStorage(() => {
    const state = loadState();
    state.cart = [
      { key: 'a_lider', productId: 'a', storeId: 'lider', qty: 2 },
      { key: 'a_lider', productId: 'a', storeId: 'lider', qty: 3 },
      { key: 'b_jumbo', productId: 'b', storeId: 'jumbo', qty: 0 },
    ];
    state.users = [
      { id: 'u1', email: 'u@ejemplo.cl', passwordHash: { salt: 's', hash: 'h', iterations: 1 } },
    ];
    state.session = {
      token: 't',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    };
    state.addresses = [{ id: 'd1', street: 'Ejemplo', commune: 'Providencia' }];
    state.tracking = {
      'UP-000123': { startedAt: Date.now(), isDemo: true },
      real: { startedAt: Date.now(), isDemo: false },
    };
    state.favoriteBenefits = ['benef-abasto', 'benef-abasto', 'inexistente'];
    state.recentSearches = ['  leche  ', 'leche', 7, null, 'coca'];
    state.lists = [
      {
        id: 'l1',
        name: '  Semanal  ',
        createdAt: new Date().toISOString(),
        items: [
          { productId: 'leche', qty: 0, notes: 5, purchased: 'sí' },
          { productId: 'arroz', qty: 3, notes: 'sin sal', purchased: true },
        ],
      },
    ];
    state.activeListId = 'l1';
    saveState(state);

    const loaded = loadState();
    assert.equal(loaded.cart.length, 1);
    assert.equal(loaded.cart[0].qty, 2);
    assert.deepEqual(Object.keys(loaded.tracking), ['UP-000123']);
    assert.deepEqual(loaded.favoriteBenefits, ['benef-abasto']);
    assert.deepEqual(loaded.recentSearches, ['leche', 'coca']);
    assert.equal(loaded.lists[0].name, 'Semanal');
    assert.equal(loaded.activeListId, 'l1');
    assert.deepEqual(loaded.lists[0].items, [
      {
        id: null,
        productId: 'leche',
        qty: 1,
        notes: '',
        purchased: false,
        addedAt: null,
      },
      {
        id: null,
        productId: 'arroz',
        qty: 3,
        notes: 'sin sal',
        purchased: true,
        addedAt: null,
      },
    ]);

    clearPersonalData();
    const clean = loadState();
    assert.equal(clean.users.length, 0);
    assert.equal(clean.session, null);
    assert.equal(clean.addresses.length, 0);
    assert.deepEqual(clean.tracking, {});
    assert.deepEqual(clean.favoriteBenefits, []);
    assert.deepEqual(clean.recentSearches, []);
    assert.deepEqual(clean.lists, []);
    assert.equal(clean.activeListId, null);
    assert.equal(clean.orders.length, 3);
    assert.equal(
      clean.orders.every((order) => order.isDemo),
      true
    );
  });
});
