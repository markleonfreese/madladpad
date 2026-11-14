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
  for(const path of ['/fonts/dm-sans-variable-latin.woff2','/fonts/dm-sans-variable-latin-ext.woff2','/fonts/dm-mono-400-latin.woff2','/fonts/dm-mono-400-latin-ext.woff2','/fonts/dm-mono-500-latin.woff2','/fonts/dm-mono-500-latin-ext.woff2','/licenses/OFL-DM-Sans.txt','/licenses/OFL-DM-Mono.txt'])
    assert.ok(shell[1].includes(`'${path}'`),`offline shell must precache ${path}`);
  const css=readFileSync(join(site,'styles.css'),'utf8');
  assert.doesNotMatch(css,/fonts\.(?:googleapis|gstatic)\.com/,'fonts must not depend on an external provider');
  assert.match(css,/font-family:'DM Sans'.*url\('\/fonts\/dm-sans-variable-latin\.woff2'\)/,'DM Sans must use its self-hosted Latin font');
  assert.match(css,/font-family:'DM Mono'.*url\('\/fonts\/dm-mono-400-latin\.woff2'\)/,'DM Mono must use its self-hosted Latin font');
  assert.ok(sw.includes("caches.match('/')"),
    'offline navigation must fall back to the canonical root route used by Workers Static Assets');
  assert.match(sw,/const CACHE = 'madladpad-shell-v25'/,'new track and editor code must activate a fresh offline shell');
});

test('v25 install precaches the updated modules, local fonts and licenses before taking control', async () => {
  const sw=readFileSync(join(site,'sw.js'),'utf8');
  const handlers=new Map();let cacheName=null,precache=[],skipped=false;
  const context={
    self:{addEventListener:(name,handler)=>handlers.set(name,handler),skipWaiting:()=>{skipped=true;return Promise.resolve();}},
    caches:{open:name=>{cacheName=name;return Promise.resolve({addAll:paths=>{precache=paths;return Promise.resolve();}});}},
    Promise,URL
  };
  runInNewContext(sw,context);
  let installation;
  handlers.get('install')({waitUntil:promise=>{installation=promise;}});
  await installation;
  assert.equal(cacheName,'madladpad-shell-v25');
  assert.ok(precache.includes('/audio.js'),'the replacement offline shell must include the fixed audio module');
  assert.ok(precache.includes('/fonts/dm-sans-variable-latin.woff2')&&precache.includes('/fonts/dm-mono-400-latin.woff2'),'the offline shell should include self-hosted UI fonts');
  assert.ok(precache.includes('/licenses/OFL-DM-Sans.txt')&&precache.includes('/licenses/OFL-DM-Mono.txt'),'the offline shell should include font license texts');
  assert.equal(skipped,true,'the complete replacement shell should activate without waiting for an old page to close');
});

test('network-first asset response waits for durable cache update and tolerates cache failures', async () => {
  const sw=readFileSync(join(site,'sw.js'),'utf8');
  const handlers=new Map();
  let releaseWrite,storedText='',writeStarted=false;
  const writeGate=new Promise(resolve=>{releaseWrite=resolve;});
  const context={
    self:{addEventListener:(name,handler)=>handlers.set(name,handler),location:{origin:'https://madladpad.test'}},
    caches:{open:()=>Promise.resolve({put:async(_request,response)=>{writeStarted=true;await writeGate;storedText=await response.text();}})},
    fetch:()=>Promise.resolve(new Response('fresh Voice Lab module')),
    URL,Promise,Request,Response
  };
  runInNewContext(sw,context);
  let responsePromise;
  handlers.get('fetch')({request:new Request('https://madladpad.test/voice.js'),respondWith:promise=>{responsePromise=promise;}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(writeStarted,true,'fresh same-origin assets should start their cache write');
  let responseResolved=false;
  responsePromise.then(()=>{responseResolved=true;});
  await Promise.resolve();
  assert.equal(responseResolved,false,'the fetch event must stay alive until the cache write finishes');
  releaseWrite();
  const response=await responsePromise;
  assert.equal(await response.text(),'fresh Voice Lab module');
  assert.equal(storedText,'fresh Voice Lab module','the fresh asset should be durable before response completion');

  const failureHandlers=new Map();
  const failureContext={
    self:{addEventListener:(name,handler)=>failureHandlers.set(name,handler),location:{origin:'https://madladpad.test'}},
    caches:{open:()=>Promise.reject(new Error('storage unavailable'))},
    fetch:()=>Promise.resolve(new Response('online response remains available')),
    URL,Promise,Request,Response
  };
  runInNewContext(sw,failureContext);
  let failureResponse;
  failureHandlers.get('fetch')({request:new Request('https://madladpad.test/voice.js'),respondWith:promise=>{failureResponse=promise;}});
  assert.equal(await (await failureResponse).text(),'online response remains available','cache write failures should not break online asset delivery');
});

test('service worker activation removes stale app shells without deleting the Whisper model cache', async () => {
  const sw = readFileSync(join(site, 'sw.js'), 'utf8');
  const handlers = new Map();
  const cacheNames = ['madladpad-shell-v11', 'madladpad-shell-v12', 'madladpad-shell-v13', 'madladpad-shell-v14', 'madladpad-shell-v15', 'madladpad-shell-v16', 'madladpad-shell-v17', 'madladpad-shell-v18', 'madladpad-shell-v19', 'madladpad-shell-v20', 'madladpad-shell-v21', 'madladpad-shell-v22', 'madladpad-shell-v23', 'madladpad-shell-v24', 'madladpad-shell-v25', 'transformers-cache', 'another-app-cache'];
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
  assert.deepEqual(deleted, ['madladpad-shell-v11', 'madladpad-shell-v12', 'madladpad-shell-v13', 'madladpad-shell-v14', 'madladpad-shell-v15', 'madladpad-shell-v16', 'madladpad-shell-v17', 'madladpad-shell-v18', 'madladpad-shell-v19', 'madladpad-shell-v20', 'madladpad-shell-v21', 'madladpad-shell-v22', 'madladpad-shell-v23', 'madladpad-shell-v24']);
});

test('Pitch loading copy does not claim the implemented processor is unavailable', () => {
  const html=readFileSync(join(site,'index.html'),'utf8');
  const app=readFileSync(join(site,'app.js'),'utf8');
  assert.match(html,/id="pitch-out">Starting…/);
  assert.match(html,/Preparing the local Pitch processor/);
  assert.doesNotMatch(html,/Independent pitch shifting is not available yet/);
  assert.match(app,/Load an audio or video sample to use independent Pitch/);
});

test('service worker bypasses cross-origin and non-GET requests, and does not cache HTTP failures', async () => {
  const sw=readFileSync(join(site,'sw.js'),'utf8');
  const handlers=new Map();
  const writes=[];let requests=0;
  const context={
    self:{addEventListener:(name,handler)=>handlers.set(name,handler),location:{origin:'https://madladpad.test'}},
    caches:{open:()=>Promise.resolve({put:async request=>{writes.push(request.url);}}),match:()=>Promise.resolve(undefined)},
    fetch:()=>{requests++;return Promise.resolve(new Response('missing',{status:404}));},
    URL,Promise,Request,Response
  };
  runInNewContext(sw,context);
  const handler=handlers.get('fetch');
  let intercepts=0;
  const respondWith=()=>{intercepts++;};
  handler({request:new Request('https://elsewhere.example/app.js'),respondWith});
  handler({request:new Request('https://madladpad.test/app.js',{method:'POST'}),respondWith});
  assert.equal(intercepts,0,'external and non-GET requests must be left to the browser');
  assert.equal(requests,0);
  let responsePromise;
  handler({request:new Request('https://madladpad.test/missing.js'),respondWith:promise=>{responsePromise=promise;}});
  assert.equal((await responsePromise).status,404,'an HTTP failure must retain its original status');
  assert.deepEqual(writes,[],'do not replace a cached good asset with a 404 response');
});

test('offline navigation falls back to canonical root while offline assets use their own cache entry', async () => {
  const sw=readFileSync(join(site,'sw.js'),'utf8');
  const handlers=new Map();const cacheReads=[];
  const context={
    self:{addEventListener:(name,handler)=>handlers.set(name,handler),location:{origin:'https://madladpad.test'}},
    caches:{
      open:()=>{throw Error('offline network must not attempt cache writes');},
      match:async request=>{
        const key=typeof request==='string'?request:request.url;
        cacheReads.push(key);
        return new Response(key==='/'?'cached app shell':'cached asset');
      }
    },
    fetch:()=>Promise.reject(new Error('offline')),
    URL,Promise,Request,Response
  };
  runInNewContext(sw,context);
  const handler=handlers.get('fetch');
  let navigation;
  handler({request:{url:'https://madladpad.test/sequence',method:'GET',mode:'navigate'},respondWith:promise=>{navigation=promise;}});
  assert.equal(await (await navigation).text(),'cached app shell');
  let asset;
  handler({request:new Request('https://madladpad.test/audio.js'),respondWith:promise=>{asset=promise;}});
  assert.equal(await (await asset).text(),'cached asset');
  assert.deepEqual(cacheReads,['/','https://madladpad.test/audio.js']);
});
