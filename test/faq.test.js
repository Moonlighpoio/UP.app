import test from 'node:test';
import assert from 'node:assert/strict';
import { FAQ_ITEMS, filterFaq } from '../src/faq.js';

test('el FAQ contiene temas de precios, pago, privacidad y contacto simulado', () => {
  const categories = new Set(FAQ_ITEMS.map((item) => item.category));
  for (const category of ['Precios', 'Pago', 'Privacidad', 'Uso', 'Contacto']) {
    assert.ok(categories.has(category));
  }
  assert.ok(FAQ_ITEMS.every((item) => item.id && item.question && item.answer));
});

test('la búsqueda tolera tildes y varios términos', () => {
  const results = filterFaq(FAQ_ITEMS, 'sin conexion');
  assert.ok(results.some((item) => item.id === 'faq-offline'));
  assert.ok(filterFaq(FAQ_ITEMS, 'pago tarjeta').some((item) => item.id === 'faq-tarjeta'));
  assert.equal(filterFaq(FAQ_ITEMS, '').length, FAQ_ITEMS.length);
  assert.equal(filterFaq(FAQ_ITEMS, 'no-existe-esta-palabra').length, 0);
});
