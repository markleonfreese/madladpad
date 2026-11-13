import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const site = new URL('../site/', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(site,'manifest.webmanifest'),'utf8'));

test('PWA manifest points to real installable icons', () => {
  assert.equal(manifest.display,'standalone');
  for(const icon of manifest.icons) assert.ok(existsSync(join(site,icon.src.slice(1))),`${icon.src} missing`);
  assert.ok(manifest.icons.some(icon=>icon.sizes==='192x192' && icon.type==='image/png'));
  assert.ok(manifest.icons.some(icon=>icon.sizes==='512x512' && icon.type==='image/png'));
});

test('offline shell and all locally referenced ES modules exist', () => {
  const sw=readFileSync(join(site,'sw.js'),'utf8');
  const shell=sw.match(/const SHELL = (\[[^\]]+\])/);
  assert.ok(shell);
  for(const path of JSON.parse(shell[1].replaceAll("'",'"'))) {
    if(path==='/') continue;
    assert.ok(existsSync(join(site,path.slice(1))),`${path} missing`);
  }
  assert.ok(shell[1].includes("'/onsets-worker.js'"));
  assert.ok(shell[1].includes("'/voice-inference-worker.bundle.js'"), 'offline transcription must include its local inference worker');
  assert.ok(shell[1].includes("'/tuner.js'"), 'offline shell must include the local tuner module');
  assert.ok(shell[1].includes("'/pitch-dsp.js'")&&shell[1].includes("'/pitch-shifter.js'"),
    'offline shell must include both pitch processor modules');
  assert.ok(shell[1].includes("'/tuning.js'"),'offline shell must include local note detection');
  assert.ok(shell[1].includes("'/credits.html'")&&shell[1].includes("'/licenses/Apache-2.0.txt'")&&shell[1].includes("'/licenses/MIT-OpenAI-Whisper.txt'")&&shell[1].includes("'/licenses/MIT-ONNX-Runtime.txt'"),
    'offline shell must include model/runtime credits and their license texts');
  assert.ok(sw.includes("caches.match('/')"),
    'offline navigation must fall back to the canonical root route used by Workers Static Assets');
});

test('service worker activation removes stale app shells without deleting the Whisper model cache', async () => {
  const sw = readFileSync(join(site, 'sw.js'), 'utf8');
  const handlers = new Map();
  const cacheNames = ['madladpad-shell-v11', 'madladpad-shell-v12', 'madladpad-shell-v13', 'madladpad-shell-v14', 'madladpad-shell-v15', 'madladpad-shell-v16', 'madladpad-shell-v17', 'transformers-cache', 'another-app-cache'];
  const deleted = [];
  const context = {
    self: {
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
      location: { origin: 'https://madladpad.test' }
    },
    caches: {
      keys: () => Promise.resolve(cacheNames),
      delete: name => { deleted.push(name); return Promise.resolve(true); }
    },
    URL, Promise, fetch: () => Promise.resolve(new Response('ok')), Response
  };
  runInNewContext(sw, context);
  let activation;
  handlers.get('activate')({ waitUntil: promise => { activation = promise; } });
  await activation;
  assert.deepEqual(deleted, ['madladpad-shell-v11', 'madladpad-shell-v12', 'madladpad-shell-v13', 'madladpad-shell-v14', 'madladpad-shell-v15', 'madladpad-shell-v16']);
});


test('Pitch loading copy does not claim the implemented processor is unavailable', () => {
  const html=readFileSync(join(site,'index.html'),'utf8');
  const app=readFileSync(join(site,'app.js'),'utf8');
  assert.match(html,/id="pitch-out">Starting…/);
  assert.match(html,/Preparing the local Pitch processor/);
  assert.doesNotMatch(html,/Independent pitch shifting is not available yet/);
  assert.match(app,/Load an audio or video sample to use independent Pitch/);
});
