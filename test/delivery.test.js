import test from 'node:test';
import assert from 'node:assert/strict';
import {
  communeSuggestions,
  foldText,
  nearestStoreFor,
  parseAddressInput,
  slotsFor,
  validateDeliveryAddress,
  withPickupTotals,
} from '../src/delivery.js';

const storesData = [
  { id: 'a', chain: 'lider', comuna: 'Providencia', distanceKm: 2.4 },
  { id: 'b', chain: 'lider', comuna: 'Providencia', distanceKm: 1.2 },
  { id: 'c', chain: 'jumbo', comuna: 'Ñuñoa', distanceKm: 0.8 },
];

test('la búsqueda de comunas ignora tildes y mayúsculas', () => {
  assert.equal(foldText('Ñuñoa'), 'nunoa');
  const suggestions = communeSuggestions({ query: 'nun' });
  assert.ok(suggestions.includes('Ñuñoa'));
  assert.ok(suggestions.length <= 8);
});

test('la entrada libre separa calle y comuna', () => {
  assert.deepEqual(parseAddressInput('Av. Providencia 1234, Providencia'), {
    street: 'Av. Providencia 1234',
    commune: 'Providencia',
  });
  assert.deepEqual(parseAddressInput('Ñuñoa'), { street: '', commune: 'Ñuñoa' });
  assert.deepEqual(parseAddressInput(''), { street: '', commune: '' });
});

test('la validación exige calle para despacho pero no para retiro', () => {
  const domicilio = validateDeliveryAddress({
    commune: 'Providencia',
    street: '',
    mode: 'domicilio',
  });
  assert.equal(domicilio.ok, false);
  assert.match(domicilio.errors.street, /calle y número/);

  const retiro = validateDeliveryAddress({ commune: 'Providencia', street: '', mode: 'retiro' });
  assert.equal(retiro.ok, true);

  const invalida = validateDeliveryAddress({
    commune: 'Atlantis',
    street: 'Calle 1',
    mode: 'domicilio',
  });
  assert.equal(invalida.ok, false);
  assert.match(invalida.errors.commune, /comuna/);
});

test('las franjas son deterministas y están ligadas a la cadena', () => {
  const lider = slotsFor('lider', 'domicilio');
  assert.equal(lider.length, 3);
  assert.deepEqual(lider, slotsFor('lider', 'domicilio'));
  assert.notDeepEqual(lider, slotsFor('jumbo', 'domicilio'));
  assert.ok(lider.every((slot) => /^\d{2}:\d{2}–\d{2}:\d{2}$/.test(slot.label)));
});

test('la sucursal de ejemplo más cercana respeta comuna y cadena', () => {
  const nearest = nearestStoreFor({ storesData, commune: 'providencia', chain: 'lider' });
  assert.equal(nearest.id, 'b');
  assert.equal(nearestStoreFor({ storesData, commune: 'La Florida' }), null);
});

test('el retiro es sólo presentación: no altera la matemática original', () => {
  const totals = {
    storeGroups: [{ store: { id: 'lider' }, shipping: 3990, subtotal: 20000 }],
    productsSubtotal: 20000,
    totalShipping: 3990,
    upFee: 200,
    grandTotal: 23990,
  };
  const pickup = withPickupTotals(totals);
  assert.equal(pickup.storeGroups[0].shipping, 0);
  assert.equal(pickup.totalShipping, 0);
  assert.equal(pickup.grandTotal, 20000);
  assert.equal(pickup.upFee, 200);
  assert.equal(totals.totalShipping, 3990);
  assert.equal(totals.grandTotal, 23990);
});
