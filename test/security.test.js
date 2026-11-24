import test from 'node:test';
import assert from 'node:assert/strict';
import { esc, safeHttpUrl, safeAssetUrl } from '../src/utils.js';
import { offerLink, CHAIN_SEARCH } from '../src/links.js';

test('esc neutraliza HTML en texto y atributos', () => {
  assert.equal(
    esc('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
  );
  assert.equal(esc("'"), '&#39;');
  assert.equal(esc('a & b'), 'a &amp; b');
});

test('safeHttpUrl acepta solo http/https válidos', () => {
  assert.equal(safeHttpUrl('https://www.jumbo.cl/ficha'), 'https://www.jumbo.cl/ficha');
  assert.equal(safeHttpUrl('http://lider.cl/x?q=1'), 'http://lider.cl/x?q=1');
  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//jumbo.cl/ficha',
    'not a url',
    null,
    undefined,
    123,
  ]) {
    assert.equal(safeHttpUrl(bad), null, String(bad));
  }
});

test('safeAssetUrl acepta assets/ locales y http(s), rechaza traversal y esquemas', () => {
  assert.equal(safeAssetUrl('assets/products/bebidas.svg'), 'assets/products/bebidas.svg');
  assert.equal(safeAssetUrl('https://example.com/img.png'), 'https://example.com/img.png');
  for (const bad of [
    'assets/../../etc/passwd',
    '/etc/passwd',
    'javascript:alert(1)',
    'data:image/svg+xml,<svg onload=alert(1)>',
    null,
  ]) {
    assert.equal(safeAssetUrl(bad), null, String(bad));
  }
});

test('offerLink descarta una URL canónica con esquema no seguro y cae al SKU', () => {
  const product = {
    id: 'x',
    name: 'Producto X',
    skus: { jumbo: { sku: '391', url: 'javascript:alert(1)' } },
  };
  const link = offerLink(product, 'jumbo');
  assert.equal(link.canonical, false);
  assert.equal(link.kind, 'SKU');
  assert.equal(link.url, CHAIN_SEARCH.jumbo + '391');
});

test('offerLink codifica el SKU antes de inyectarlo en la URL', () => {
  const sku = 'x" onmouseover="alert(1)';
  const product = { id: 'x', name: 'Producto X', skus: { lider: { sku, url: null } } };
  const link = offerLink(product, 'lider');
  assert.equal(link.url, CHAIN_SEARCH.lider + encodeURIComponent(sku));
  assert.equal(link.url.includes('"'), false);
  assert.equal(link.url.includes('%22'), true);
});
