const CACHE = 'rivet-shell-v2';
const FILES = ['./fonts/cinzel-semibold.ttf', './fonts/cinzel-decorative-bold.ttf', './', './index.html', './styles.css', './app.js', './model.js', './firebase.js', './firebase-config.js', './icon.svg', './icon-192.png', './icon-512.png', './manifest.webmanifest'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('rivet-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/__') || url.pathname.includes('signin-with-chatgpt') || url.pathname.includes('callback')) return;
  const file = url.pathname.split('/').pop();
  const allowed = new Set(['cinzel-semibold.ttf', 'cinzel-decorative-bold.ttf', '', 'index.html', 'styles.css', 'app.js', 'model.js', 'firebase.js', 'firebase-config.js', 'icon.svg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest']);
  if (!allowed.has(file)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && !response.redirected) { const copy=response.clone(); caches.open(CACHE).then(cache=>cache.put(event.request,copy)); }
    return response;
  }).catch(()=>caches.match(event.request).then(response=>response || (event.request.mode==='navigate' ? caches.match('./index.html') : Response.error()))));
});
