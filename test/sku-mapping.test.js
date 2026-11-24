import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { CHAIN_SEARCH, isPurchaseBlocked, offerLink } from '../src/links.js';

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

test('Jumbo conserva SKU propio y ficha canónica; las demás cadenas usan el GTIN', () => {
  for (const product of products) {
    const jumbo = offerLink(product, 'jumbo');
    assert.equal(jumbo.canonical, true);
    assert.match(jumbo.token, /^[0-9]+$/);
    for (const chainId of UI_CHAINS.filter((id) => id !== 'jumbo')) {
      const link = offerLink(product, chainId);
      assert.equal(link.canonical, false);
      assert.equal(link.token, product.skus.jumbo.gtin);
      assert.equal(link.url, CHAIN_SEARCH[chainId] + product.skus.jumbo.gtin);
    }
  }
});

test('los patrones de búsqueda VTEX vigentes usan /busca?ft=', () => {
  assert.equal(CHAIN_SEARCH.jumbo, 'https://www.jumbo.cl/busca?ft=');
  assert.equal(CHAIN_SEARCH.santaisabel, 'https://www.santaisabel.cl/busca?ft=');
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
