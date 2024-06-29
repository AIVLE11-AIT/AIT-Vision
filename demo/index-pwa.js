/**
 * PWA Service Worker for Human main demo
 */

/* eslint-disable no-restricted-globals */
/// <reference lib="webworker" />

const skipCaching = false;

const cacheName = 'Human';
const cacheFiles = ['/favicon.ico', 'manifest.webmanifest']; // assets and models are cached on first access

let cacheModels = true; // *.bin; *.json
let cacheWASM = true; // *.wasm
let cacheOther = false; // *

let listening = false;
const stats = { hit: 0, miss: 0 };

const log = (...msg) => {
  const dt = new Date();
  const ts = `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}:${dt.getSeconds().toString().padStart(2, '0')}.${dt.getMilliseconds().toString().padStart(3, '0')}`;
  console.log(ts, 'pwa', ...msg); // eslint-disable-line no-console
};

async function updateCached(req) {
  try {
    const update = await fetch(req);
    if (update.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(req, update.clone());
    }
    return true;
  } catch (err) {
    log('cache update error', err);
    return false;
  }
}

async function getCached(evt) {
  // just fetch
  if (skipCaching) return fetch(evt.request);

  // get from cache or fetch if not in cache
  try {
    let found = await caches.match(evt.request);
    if (found && found.ok) {
      stats.hit += 1;
    } else {
      stats.miss += 1;
      found = await fetch(evt.request);
    }

    // if still don't have it, return offline page
    if (!found || !found.ok) {
      found = await caches.match('offline.html');
    }

    // update cache in the background
    if (found && found.type === 'basic' && found.ok) {
      const uri = new URL(evt.request.url);
      if (uri.pathname.endsWith('.bin') || uri.pathname.endsWith('.json')) {
        if (cacheModels) await updateCached(evt.request);
      } else if (uri.pathname.endsWith('.wasm')) {
        if (cacheWASM) await updateCached(evt.request);
      } else if (cacheOther) {
        await updateCached(evt.request);
      }
    }

    return found;
  } catch (err) {
    log('fetch error', err);
    return caches.match('offline.html');
  }
}

function cacheInit() {
  caches.open(cacheName)
    .then((cache) => cache.addAll(cacheFiles))
    .then(() => log('cache refresh:', cacheFiles.length, 'files'))
    .catch((err) => log('cache error', err));
}

if (!listening) {
  // get messages from main app to update configuration
  self.addEventListener('message', (evt) => {
    log('event message:', evt.data);
    switch (evt.data.key) {
      case 'cacheModels': cacheModels = evt.data.val; break;
      case 'cacheWASM': cacheWASM = evt.data.val; break;
      case 'cacheOther': cacheOther = evt.data.val; break;
      default:
    }
  });

  self.addEventListener('install', (evt) => {
    log('install');
    self.skipWaiting();
    evt.waitUntil(cacheInit());
  });

  self.addEventListener('activate', (evt) => {
    log('activate');
    evt.waitUntil(self.clients.claim());
  });

  self.addEventListener('fetch', (evt) => {
    const uri = new URL(evt.request.url);
    if (evt.request.cache === 'only-if-cached' && evt.request.mode !== 'same-origin') return;
    if (uri.origin !== self.location.origin) return;
    if (evt.request.method !== 'GET') return;
    if (evt.request.url.includes('/api/')) return;

    evt.respondWith(getCached(evt));
  });

  // only trigger controllerchange once
  let refreshed = false;
  self.addEventListener('controllerchange', (evt) => {
    log(`PWA: ${evt.type}`);
    if (refreshed) return;
    refreshed = true;
    self.location.reload();
  });

  listening = true;
}
