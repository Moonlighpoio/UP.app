import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SIMULATION_SPEED,
  STAGE_DURATIONS_SIM,
  getDemoTracking,
  pointOnRoute,
  stageAt,
  stageStartsSim,
} from '../src/demo-tracking.js';

test('el seguimiento de ejemplo es ficticio y explícitamente no verificado', () => {
  const tracking = getDemoTracking('UP-000123');
  assert.equal(tracking.isDemo, true);
  assert.equal(tracking.status, 'demo');
  assert.equal(tracking.verifiedAt, null);
  assert.equal(tracking.sourceUrl, null);
  assert.match(tracking.source, /demo/);

  const copy = getDemoTracking('UP-000123');
  copy.route[0][0] = 0;
  assert.notEqual(getDemoTracking('UP-000123').route[0][0], 0);
  assert.equal(getDemoTracking('no-existe'), null);
});

test('la simulación acelerada recorre cuatro etapas en 30 segundos reales', () => {
  assert.equal(SIMULATION_SPEED, 10);
  assert.deepEqual([...STAGE_DURATIONS_SIM], [90, 90, 120]);
  assert.deepEqual(stageStartsSim(), [0, 90, 180, 300]);
  assert.equal(stageAt(0).index, 0);
  assert.equal(stageAt(89).index, 0);
  assert.equal(stageAt(90).index, 1);
  assert.equal(stageAt(180).index, 2);
  assert.equal(stageAt(299).index, 2);
  const done = stageAt(300);
  assert.equal(done.index, 3);
  assert.equal(done.done, true);
  assert.equal(done.progress, 1);
});

test('el repartidor se interpola sobre la ruta sin salirse de los extremos', () => {
  const route = [
    [0, 0],
    [0, 1],
    [1, 1],
  ];
  assert.deepEqual(pointOnRoute(route, 0), [0, 0]);
  assert.deepEqual(pointOnRoute(route, 1), [1, 1]);
  const middle = pointOnRoute(route, 0.5);
  assert.ok(middle[0] >= 0 && middle[0] <= 1);
  assert.ok(middle[1] >= 0 && middle[1] <= 1);
  assert.deepEqual(pointOnRoute([[1, 2]], 0.4), [1, 2]);
});
