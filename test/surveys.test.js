import test from 'node:test';
import assert from 'node:assert/strict';
import { hasSurveyFor, submitSurvey, surveyAverage } from '../src/surveys.js';

function state() {
  return { surveys: [], analytics: [] };
}

test('la micro-encuesta es de un clic y se guarda una sola vez por orden', () => {
  const saved = state();
  const first = submitSurvey(
    saved,
    { orderId: 'UP-DEMO-ABC123', rating: 5 },
    { now: 1700000000000 }
  );
  assert.ok(first);
  assert.equal(first.isDemo, true);
  assert.equal(hasSurveyFor(saved, 'UP-DEMO-ABC123'), true);
  assert.equal(submitSurvey(saved, { orderId: 'UP-DEMO-ABC123', rating: 2 }), null);
  assert.equal(saved.surveys.length, 1);
  assert.deepEqual(
    saved.analytics.map((event) => event.event),
    ['survey_submit']
  );
  assert.equal(saved.analytics[0].props.orderId, undefined);
});

test('rechaza puntuaciones fuera de rango y órdenes vacías', () => {
  const saved = state();
  assert.equal(submitSurvey(saved, { orderId: 'A', rating: 0 }), null);
  assert.equal(submitSurvey(saved, { orderId: '', rating: 4 }), null);
  assert.equal(submitSurvey(saved, { orderId: 'A', rating: 6 }), null);
  assert.equal(saved.surveys.length, 0);
});

test('el promedio es referencial y no inventa respuestas', () => {
  assert.equal(surveyAverage([]), null);
  assert.equal(surveyAverage([{ rating: 1 }, { rating: 2 }, { rating: 9 }]), 1.5);
});
