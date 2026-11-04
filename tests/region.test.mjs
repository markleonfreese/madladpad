import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../site/core.js';

test('region can select a later moment and clamps to actual duration', () => {
  assert.equal(typeof core.normaliseRegion, 'function');
  assert.deepEqual(core.normaliseRegion(42,44,60), {start:42,end:44});
  assert.deepEqual(core.normaliseRegion(42,99,60), {start:42,end:60});
});

test('region keeps ordered bounds when either handle crosses the other', () => {
  assert.deepEqual(core.normaliseRegion(9,3,10,'start'), {start:9,end:9.05});
  assert.deepEqual(core.normaliseRegion(9,3,10,'end'), {start:2.95,end:3});
});
