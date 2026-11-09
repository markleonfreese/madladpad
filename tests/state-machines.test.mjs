import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncActivity } from '../site/core.js';

test('a pending start cannot be duplicated and becomes active only once', () => {
  const activity = new AsyncActivity();
  const token = activity.begin();
  assert.equal(activity.phase, 'starting');
  assert.equal(activity.begin(), null);
  assert.equal(activity.activate(token), true);
  assert.equal(activity.phase, 'active');
  assert.equal(activity.activate(token), false);
  assert.equal(activity.begin(), null);
});

test('stop while starting invalidates delayed device or audio permission', async () => {
  const activity = new AsyncActivity();
  let resolvePermission;
  const permission = new Promise(resolve => { resolvePermission = resolve; });
  const token = activity.begin();
  const start = permission.then(() => activity.activate(token));
  activity.cancel();
  resolvePermission();
  assert.equal(await start, false);
  assert.equal(activity.phase, 'idle');
});

test('a canceled first start cannot override a later start', () => {
  const activity = new AsyncActivity();
  const first = activity.begin();
  activity.cancel();
  const second = activity.begin();
  assert.notEqual(first, second);
  assert.equal(activity.current(first), false);
  assert.equal(activity.activate(first), false);
  assert.equal(activity.activate(second), true);
  assert.equal(activity.phase, 'active');
});

test('canceling an active operation invalidates late callbacks and permits retry', () => {
  const activity = new AsyncActivity();
  const token = activity.begin();
  assert.equal(activity.activate(token), true);
  activity.cancel();
  assert.equal(activity.current(token), false);
  assert.equal(activity.phase, 'idle');
  assert.equal(activity.activate(activity.begin()), true);
});
