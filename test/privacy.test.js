import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptPrivacy, PRIVACY_VERSION, privacyAccepted } from '../src/privacy.js';

test('el aviso se marca una sola vez con versión y fecha, sin datos personales', () => {
  const saved = {};
  assert.equal(privacyAccepted(saved), false);
  const value = acceptPrivacy(saved, { now: 1700000000000 });
  assert.equal(privacyAccepted(saved), true);
  assert.equal(value.noticeVersion, PRIVACY_VERSION);
  assert.equal(value.acceptedAt, '2023-11-14T22:13:20.000Z');
  assert.equal(value.analytics, true);
  assert.deepEqual(Object.keys(saved.privacy).sort(), ['acceptedAt', 'analytics', 'noticeVersion']);
});
