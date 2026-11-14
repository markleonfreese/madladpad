const CACHE = 'madladpad-shell-v28';
const SHELL = ['/', '/styles.css', '/app.js', '/core.js', '/file-input.js', '/audio.js', '/pitch-dsp.js', '/pitch-shifter.js', '/tuning.js', '/storage.js', '/google.js', '/onsets.js', '/onsets-worker.js', '/voice.js', '/voice-inference-worker.bundle.js', '/tuner.js', '/google-config.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/fonts/dm-sans-variable-latin-ext.woff2', '/fonts/dm-sans-variable-latin.woff2', '/fonts/dm-mono-400-latin-ext.woff2', '/fonts/dm-mono-400-latin.woff2', '/fonts/dm-mono-500-latin-ext.woff2', '/fonts/dm-mono-500-latin.woff2', '/credits.html', '/licenses/Apache-2.0.txt', '/licenses/MIT-OpenAI-Whisper.txt', '/licenses/MIT-ONNX-Runtime.txt', '/licenses/OFL-DM-Sans.txt', '/licenses/OFL-DM-Mono.txt'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('madladpad-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }
  // Keep the worker alive until the fresh response is durable for an offline reopen.
  event.respondWith(fetch(request).then(response => {
    if (!response.ok) return response;
    return caches.open(CACHE)
      .then(cache=>cache.put(request,response.clone()))
      .then(()=>response)
      .catch(()=>response);
  }).catch(()=>caches.match(request)));
});
