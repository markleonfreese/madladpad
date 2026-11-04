const CACHE = 'madladpad-shell-v4';
const SHELL = ['/', '/styles.css', '/app.js', '/core.js', '/audio.js', '/pitch-dsp.js', '/pitch-shifter.js', '/storage.js', '/google.js', '/onsets.js', '/onsets-worker.js', '/google-config.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }
  // Network-first prevents a stale local shell persisting after a new Cloudflare release.
  event.respondWith(fetch(request).then(response => {
    if (response.ok) {const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}
    return response;
  }).catch(()=>caches.match(request)));
});
