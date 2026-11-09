import test from 'node:test';
import assert from 'node:assert/strict';
import { processInputFiles } from '../site/file-input.js';

test('file input processing retains input and files after a browser clears event.target', async () => {
  const file = { name: 'sample.wav' };
  const input = { files: [file], value: 'sample.wav' };
  let dispatchedTarget = input;
  const event = { get target() { return dispatchedTarget; } };

  const result = await processInputFiles(event, async files => {
    assert.deepEqual(files, [file]);
    await Promise.resolve();
    dispatchedTarget = null;
    return 'imported';
  });

  assert.equal(result, 'imported');
  assert.equal(input.value, '');
});

test('file input is cleared after an asynchronous import failure', async () => {
  const input = { files: [{ name: 'broken.wav' }], value: 'broken.wav' };
  await assert.rejects(processInputFiles({ target: input }, async () => {
    await Promise.resolve();
    throw new Error('decode failed');
  }), /decode failed/);
  assert.equal(input.value, '');
});
