import test from 'node:test';
import assert from 'node:assert/strict';
import { offerLink, reindexKey, CHAIN_SEARCH } from '../src/links.js';

const product = (skus, name = 'Bebida Coca-Cola Original') => ({ id: 'coca', name, skus });

test('offerLink prioriza la URL canónica aunque haya SKU y GTIN', () => {
  const p = product({
    jumbo: { sku: '391', gtin: '7801610001622', url: 'https://www.jumbo.cl/ficha-coca/p' },
  });
  const link = offerLink(p, 'jumbo');
  assert.equal(link.url, 'https://www.jumbo.cl/ficha-coca/p');
  assert.equal(link.canonical, true);
  assert.equal(link.kind, 'ficha');
  assert.equal(link.token, '391');
});

test('offerLink usa búsqueda exacta por SKU cuando no hay URL', () => {
  const p = product({ jumbo: { sku: 'ABC 123', url: null } });
  const link = offerLink(p, 'jumbo');
  assert.equal(link.url, CHAIN_SEARCH.jumbo + encodeURIComponent('ABC 123'));
  assert.equal(link.canonical, false);
  assert.equal(link.kind, 'SKU');
  assert.equal(link.token, 'ABC 123');
});

test('offerLink cae al GTIN si no hay SKU', () => {
  const p = product({ lider: { gtin: '7801610001622', url: null } });
  const link = offerLink(p, 'lider');
  assert.equal(link.url, CHAIN_SEARCH.lider + '7801610001622');
  assert.equal(link.token, '7801610001622');
  assert.equal(link.kind, 'SKU');
});

test('offerLink cae al PLU de granel sin confundirlo con GTIN', () => {
  const p = product({ lider: { gtin: null, plu: '24851794', url: null } });
  const link = offerLink(p, 'lider');
  assert.equal(link.url, CHAIN_SEARCH.lider + '24851794');
  assert.equal(link.token, '24851794');
  assert.equal(link.kind, 'SKU');
});

test('offerLink sin SKU mapeado devuelve url null', () => {
  const p = product({ tottus: { sku: null, url: null } });
  assert.deepEqual(offerLink(p, 'tottus'), {
    url: null,
    canonical: false,
    token: null,
    kind: 'none',
  });
});

test('offerLink nunca construye una URL a partir del nombre del producto', () => {
  const name = 'Bebida Coca-Cola Original 1,5 L';
  const p = product({}, name);
  const link = offerLink(p, 'jumbo');
  assert.equal(link.url, null);
  assert.equal(link.kind, 'none');
  assert.equal(JSON.stringify(link).includes('Coca-Cola'), false);
  assert.equal(JSON.stringify(link).includes('Original'), false);
});

test('offerLink no fabrica URLs para cadenas sin patrón de búsqueda', () => {
  const p = product({ coope: { sku: '123', url: null } });
  assert.equal(offerLink(p, 'coope').url, null);
});

test('reindexKey es estable por producto y cadena', () => {
  assert.equal(reindexKey('coca', 'jumbo'), 'coca|jumbo');
});
