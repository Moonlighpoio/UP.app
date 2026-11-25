import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_BANK_BENEFITS,
  DEMO_PROMOS,
  bankBenefitIds,
  getBankBenefit,
} from '../src/demo-content.js';

const ITEMS = [...DEMO_PROMOS, ...DEMO_BANK_BENEFITS];

test('todo el contenido editorial es ejemplo y declara su procedencia', () => {
  assert.ok(ITEMS.length > 0);
  for (const item of ITEMS) {
    assert.equal(item.isDemo, true, item.id);
    assert.equal(item.status, 'demo', item.id);
    assert.equal(item.verifiedAt, null, item.id);
    assert.equal(item.sourceUrl, null, item.id);
    assert.match(item.source, /demo/, item.id);
    assert.ok(item.title && item.summary, item.id);
  }
});

test('los beneficios bancarios no contienen datos de pago', () => {
  const text = JSON.stringify(DEMO_BANK_BENEFITS);
  assert.doesNotMatch(text, /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/);
  assert.doesNotMatch(text, /\b\d{3,4}\s*\/\s*\d{2}\s*\/\s*\d{2}\b/);
  assert.doesNotMatch(text, /password|contraseña/i);
});

test('los favoritos sólo apuntan a beneficios conocidos y únicos', () => {
  const ids = bankBenefitIds();
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(getBankBenefit('inexistente'), null);
  for (const id of ids) assert.equal(getBankBenefit(id)?.id, id);
});
