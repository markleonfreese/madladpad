import test from 'node:test';
import assert from 'node:assert/strict';
import { SamplerAudio } from '../site/audio.js';
import * as storage from '../site/storage.js';

test('demo pad triggers without a temporal-dead-zone exception', () => {
  const sampler = Object.create(SamplerAudio.prototype);
  sampler.context = { currentTime: 0 };
  sampler.sources = new Map();
  sampler.demoEnabled = true;
  sampler.playDemo = () => {};
  assert.equal(sampler.trigger(0, {volume: 1}, () => {}, 0), true);
});

test('pack replacement aborts every saved change if a media write fails', async () => {
  assert.equal(typeof storage.replaceProjectMedia, 'function');
  const saved = new Map([['project', 'old project'], ['media:0', 'old media']]);
  let closed = false;
  globalThis.indexedDB = {open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        close() { closed = true; },
        transaction() {
          const pending = new Map(saved);
          const tx = {error: new Error('quota exceeded'), objectStore() { return {
            put(value, key) { if (key === 'media:1') { queueMicrotask(() => tx.onabort()); return; } pending.set(key, value); },
            delete(key) { pending.delete(key); }
          }; }};
          return tx;
        }
      };
      request.onsuccess();
    });
    return request;
  }};
  try {
    await assert.rejects(storage.replaceProjectMedia('new project', ['new media', 'failure', ...Array(14).fill(null)]), /quota exceeded/);
    assert.deepEqual([...saved], [['project', 'old project'], ['media:0', 'old media']]);
    assert.equal(closed, true);
  } finally { delete globalThis.indexedDB; }
});

test('pack replacement saves metadata and all media slots in one transaction', async () => {
  const saved = new Map([['project', 'old'], ['media:1', 'removed']]);
  let transactions = 0;
  globalThis.indexedDB = {open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {close() {}, transaction() {
        transactions++;
        const pending = new Map(saved);
        const tx = {objectStore() { return {
          put(value, key) { pending.set(key, value); },
          delete(key) { pending.delete(key); }
        }; }};
        queueMicrotask(() => { saved.clear(); for (const entry of pending) saved.set(...entry); tx.oncomplete(); });
        return tx;
      }};
      request.onsuccess();
    });
    return request;
  }};
  try {
    await storage.replaceProjectMedia('new', ['audio', ...Array(15).fill(null)]);
    assert.equal(transactions, 1);
    assert.deepEqual([...saved], [['project', 'new'], ['media:0', 'audio']]);
  } finally { delete globalThis.indexedDB; }
});
