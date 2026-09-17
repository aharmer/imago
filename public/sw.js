// Keeps imagoLabel working without a network connection. The app's own files are cached as they
// are used; the segmentation model is cached separately by Transformers.js, and images never leave
// the user's computer, so an annotating session needs nothing from the network after the first run.
const CACHE = 'imagolabel-v1';

self.addEventListener('install', () => {
  // The new worker waits until the page asks it to take over (see the "update ready" prompt).
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('imagolabel-') && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const hit = (await cache.match(request)) ?? (await cache.match('/index.html')) ?? (await cache.match('/'));
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Leave model downloads and anything else off-site alone: Transformers.js has its own cache.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  } else {
    // Built assets carry a content hash in their name, so they never change under the same URL.
    event.respondWith(cacheFirst(request));
  }
});
