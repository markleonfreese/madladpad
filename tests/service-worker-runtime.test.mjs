import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the checked-in service worker, not a duplicate copy of its fetch logic.
const workerSource = readFileSync(new URL('../site/sw.js', import.meta.url), 'utf8');

function harness({ offline = false, writeFails = false } = {}) {
  const listeners = new Map();
  const stored = new Map();
  const puts = [];
  const cache = {
    addAll: async () => {},
    put: async (request, response) => {
      puts.push(request.url);
      if (writeFails) throw new Error('QuotaExceededError');
      stored.set(request.url, response);
    },
  };
  const caches = {
    open: async () => cache,
    match: async request => stored.get(typeof request === 'string' ? request : request.url),
    keys: async () => ['madladpad-shell-v19', 'madladpad-shell-v20', 'transformers-cache'],
    delete: async () => true,
  };
  let networkRequests = 0;
  const networkResponse = {
    ok: true,
    status: 200,
    source: 'network',
    clone() { return { ok: true, status: 200, source: 'cached-copy' }; },
  };
  const fetch = async () => {
    networkRequests++;
    if (offline) throw new Error('offline');
    return networkResponse;
  };
  const self = {
    location: { origin: 'https://madladpad.pages.dev' },
    addEventListener(type, listener) { listeners.set(type, listener); },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  runInNewContext(workerSource, { self, caches, fetch, URL });
  async function request(url = 'https://madladpad.pages.dev/app.js', options = {}) {
    let responsePromise;
    listeners.get('fetch')({
      request: { url, method: options.method ?? 'GET', mode: options.mode ?? 'same-origin' },
      respondWith(promise) { responsePromise = promise; },
    });
    return responsePromise === undefined ? undefined : responsePromise;
  }
  return {
    request, stored, puts, get networkRequests() { return networkRequests; },
    setOffline(value) { offline = value; },
  };
}

test('online same-origin GET is cached before its response settles, then available offline', async () => {
  const h = harness();
  assert.equal((await h.request()).source, 'network');
  assert.equal(h.puts.length, 1);
  assert.equal(h.stored.get('https://madladpad.pages.dev/app.js').source, 'cached-copy');
  h.setOffline(true);
  assert.equal((await h.request()).source, 'cached-copy');
});

test('failed cache write does not discard a successful online response', async () => {
  const h = harness({ writeFails: true });
  assert.equal((await h.request()).source, 'network');
  assert.equal(h.puts.length, 1);
});

test('cross-origin and non-GET requests bypass service-worker fetch handling', async () => {
  const h = harness();
  assert.equal(await h.request('https://example.org/app.js'), undefined);
  assert.equal(await h.request('https://madladpad.pages.dev/app.js', { method: 'POST' }), undefined);
  assert.equal(h.networkRequests, 0);
});
