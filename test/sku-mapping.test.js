import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { CHAIN_SEARCH, isPurchaseBlocked, offerLink } from '../src/links.js';

const require = createRequire(import.meta.url);
const { SEARCH_BY_CHAIN } = require('../scripts/catalog-db.js');

const UI_CHAINS = ['lider', 'jumbo', 'tottus', 'unimarc', 'santaisabel'];
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../data/demo.js', import.meta.url), 'utf8'), ctx);
const products = ctx.window.UP_DEMO_DATA.products;

test('los 30 productos tienen identificador y enlace en las 5 cadenas de la UI', () => {
  assert.equal(products.length, 30);
  for (const product of products) {
    for (const chainId of UI_CHAINS) {
      const link = offerLink(product, chainId);
      assert.ok(link.token, `${product.id} sin identificador en ${chainId}`);
      assert.ok(link.url, `${product.id} sin enlace en ${chainId}`);
      assert.equal(isPurchaseBlocked(product, chainId), false);
    }
  }
});

function ean13(value) {
  if (!/^\d{13}$/.test(value || '')) return false;
  const digits = [...value].map(Number);
  const sum = digits.slice(0, 12).reduce((total, digit, i) => total + digit * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === digits[12];
}

test('Jumbo conserva SKU propio y ficha canónica; las demás usan GTIN o PLU', () => {
  let gtinCount = 0;
  let pluCount = 0;
  for (const product of products) {
    const jumbo = offerLink(product, 'jumbo');
    assert.equal(jumbo.canonical, true);
    assert.match(jumbo.token, /^[0-9]+$/);
    const universal = product.skus.jumbo.gtin || product.skus.jumbo.plu;
    assert.ok(universal, `${product.id} sin GTIN ni PLU`);
    if (product.skus.jumbo.gtin) {
      assert.equal(ean13(product.skus.jumbo.gtin), true, product.id);
      gtinCount += 1;
    } else {
      assert.match(product.skus.jumbo.plu, /^\d{8}$/);
      pluCount += 1;
    }
    for (const chainId of UI_CHAINS.filter((id) => id !== 'jumbo')) {
      const link = offerLink(product, chainId);
      assert.equal(link.canonical, false);
      assert.equal(link.token, universal);
      assert.equal(link.url, CHAIN_SEARCH[chainId] + universal);
    }
  }
  assert.equal(gtinCount, 27);
  assert.equal(pluCount, 3);
});

test('los patrones de búsqueda VTEX vigentes usan /busca?ft=', () => {
  assert.equal(CHAIN_SEARCH.jumbo, 'https://www.jumbo.cl/busca?ft=');
  assert.equal(CHAIN_SEARCH.santaisabel, 'https://www.santaisabel.cl/busca?ft=');
});

test('la cola SQLite usa exactamente los patrones verificados de la UI', () => {
  assert.deepEqual(SEARCH_BY_CHAIN, {
    lider: CHAIN_SEARCH.lider,
    santaisabel: CHAIN_SEARCH.santaisabel,
    tottus: CHAIN_SEARCH.tottus,
    unimarc: CHAIN_SEARCH.unimarc,
  });
  assert.equal(SEARCH_BY_CHAIN.jumbo, undefined);
  assert.equal(SEARCH_BY_CHAIN.coope, undefined);
});

test('el feed de ejemplo no copia el SKU de Jumbo a otras cadenas', () => {
  const feed = JSON.parse(
    readFileSync(new URL('../data/live-prices.example.json', import.meta.url), 'utf8')
  );
  for (const product of feed.products) {
    const jumbo = product.offers.find((offer) => offer.chainId === 'jumbo');
    for (const offer of product.offers.filter((item) => item.chainId !== 'jumbo')) {
      assert.notEqual(offer.sku, jumbo.sku);
      assert.equal(offer.gtin, jumbo.gtin);
    }
  }
});
