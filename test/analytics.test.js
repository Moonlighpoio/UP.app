import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ANALYTICS_EVENTS, trackEvent } from '../src/analytics.js';

const root = new URL('../src/', import.meta.url);
const sources = [
  ...readdirSync(root).filter((name) => name.endsWith('.js') && name !== 'analytics.js'),
  ...readdirSync(new URL('views/', root))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `views/${name}`),
]
  .map((file) => readFileSync(new URL(file, root), 'utf8'))
  .join('\n');

test('los nueve eventos requeridos existen y tienen emisor en la interfaz', () => {
  const required = [
    'search',
    'search_no_results',
    'view_product',
    'add_to_cart',
    'click_store_link',
    'report_price',
    'checkout_start',
    'checkout_complete',
    'alert_created',
  ];
  for (const event of required) {
    assert.ok(ANALYTICS_EVENTS.includes(event), `${event} debe estar en la whitelist`);
    assert.ok(sources.includes(`'${event}'`), `${event} debe tener un emisor`);
  }
});

test('trackEvent guarda fecha y elimina datos personales de las propiedades', () => {
  const saved = {};
  const item = trackEvent(
    saved,
    'view_product',
    {
      productId: 'coca-original-15l',
      email: 'x@ejemplo.cl',
      name: 'Ana',
      userId: 'u1',
      password: 'secreto',
      token: 'abc',
      long: 'a'.repeat(500),
    },
    { now: 1700000000000 }
  );
  assert.equal(item.event, 'view_product');
  assert.equal(item.at, '2023-11-14T22:13:20.000Z');
  assert.deepEqual(Object.keys(item.props).sort(), ['long', 'productId']);
  assert.equal(item.props.long.length, 120);
  assert.equal(saved.analytics.length, 1);
});

test('la whitelist rechaza eventos inventados', () => {
  const saved = { analytics: [] };
  assert.equal(trackEvent(saved, 'compra_real', {}), null);
  assert.equal(saved.analytics.length, 0);
});
