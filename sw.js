/* WorshipBase Service Worker v70.13
   Goals:
   - Never trap users on an old index.html.
   - Keep the app shell available offline.
   - Cache pad audio only when used, not all 36 files up front.
   - Support cached MP3 range requests so audio can work offline after it has been cached.
*/
const WB_SW_VERSION = '70.13';
const SHELL_CACHE = `worshipbase-shell-${WB_SW_VERSION}`;
const STATIC_CACHE = `worshipbase-static-${WB_SW_VERSION}`;
const AUDIO_CACHE = `worshipbase-audio-${WB_SW_VERSION}`;
const CACHE_PREFIXES = ['worshipbase-shell-', 'worshipbase-static-', 'worshipbase-audio-', 'wb-shell-', 'wb-runtime-', 'wb-audio-'];

const scopeUrl = new URL(self.registration.scope);
const toScopeUrl = path => new URL(path, scopeUrl).href;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/wb-icon-180.png',
  './assets/wb-icon-192.png'
].map(toScopeUrl);

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(precacheShell());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => {
      const isWorshipBaseCache = CACHE_PREFIXES.some(prefix => key.startsWith(prefix));
      const isCurrent = [SHELL_CACHE, STATIC_CACHE, AUDIO_CACHE].includes(key);
      if (isWorshipBaseCache && !isCurrent) return caches.delete(key);
      return Promise.resolve(false);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'WB_CLEAR_CACHES') {
    event.waitUntil(clearAllWorshipBaseCaches());
    return;
  }
  if (data.type === 'WB_CACHE_URL' && data.url) {
    event.waitUntil(cacheUrl(data.url));
    return;
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (!request || request.method !== 'GET') return;

  const url = new URL(request.url);

  // Only handle this WorshipBase site. Let Firebase/Google/etc. pass through normally.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/sw.js')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (request.mode === 'navigate' || request.destination === 'document' || isIndexUrl(url)) {
    event.respondWith(networkFirstHtml(request));
    return;
  }

  if (isPadAudio(url)) {
    event.respondWith(audioStrategy(request));
    return;
  }

  if (isStaticAsset(request, url)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }
});

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(APP_SHELL.map(async href => {
    try {
      const request = new Request(href, { cache: 'reload' });
      const response = await fetch(request);
      if (response && response.ok) await cache.put(request, response.clone());
    } catch (_) {
      // Do not fail install just because one optional icon/manifest is missing.
    }
  }));
}

async function networkFirstHtml(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) {
      await cache.put(toScopeUrl('./index.html'), response.clone());
      await cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    return (await cache.match(request)) ||
           (await cache.match(toScopeUrl('./index.html'))) ||
           (await cache.match(toScopeUrl('./'))) ||
           new Response('<!doctype html><title>WorshipBase offline</title><body style="font-family:-apple-system;padding:24px">WorshipBase is offline and has not been cached yet.</body>', {
             headers: { 'Content-Type': 'text/html; charset=utf-8' }
           });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request).then(response => {
    if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  }).catch(() => cached);
  return cached || networkPromise;
}

async function audioStrategy(request) {
  if (request.headers.has('range')) {
    return rangeAudioResponse(request);
  }

  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(request.url);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok && response.status === 200) {
      await cache.put(request.url, response.clone());
    }
    return response;
  } catch (_) {
    return cached || new Response('', { status: 504, statusText: 'Audio unavailable offline' });
  }
}

async function rangeAudioResponse(request) {
  const cache = await caches.open(AUDIO_CACHE);
  let cached = await cache.match(request.url);

  // If we only receive a range request first, fetch the full file once so future
  // offline playback can serve proper byte ranges from the cached full response.
  if (!cached) {
    try {
      const fullResponse = await fetch(new Request(request.url, { cache: 'reload' }));
      if (fullResponse && fullResponse.ok && fullResponse.status === 200) {
        await cache.put(request.url, fullResponse.clone());
        cached = fullResponse;
      } else {
        return fullResponse;
      }
    } catch (_) {
      return new Response('', { status: 504, statusText: 'Audio unavailable offline' });
    }
  }

  try {
    return await makeRangeResponse(request, cached);
  } catch (_) {
    return cached;
  }
}

async function makeRangeResponse(request, response) {
  const rangeHeader = request.headers.get('range') || '';
  const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
  if (!match) return response;

  const blob = await response.clone().blob();
  const size = blob.size;
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;

  // Suffix byte range: bytes=-500
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  }

  start = Math.max(0, Math.min(start, size - 1));
  end = Math.max(start, Math.min(end, size - 1));

  const sliced = blob.slice(start, end + 1);
  const headers = new Headers(response.headers);
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(sliced.size));
  headers.set('Content-Type', response.headers.get('Content-Type') || 'audio/mpeg');

  return new Response(sliced, { status: 206, statusText: 'Partial Content', headers });
}

async function cacheUrl(url) {
  try {
    const target = new URL(url, self.registration.scope);
    if (target.origin !== self.location.origin) return;
    const cacheName = isPadAudio(target) ? AUDIO_CACHE : STATIC_CACHE;
    const cache = await caches.open(cacheName);
    const response = await fetch(new Request(target.href, { cache: 'reload' }));
    if (response && response.ok && response.status === 200) {
      await cache.put(target.href, response.clone());
    }
  } catch (_) {}
}

async function clearAllWorshipBaseCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.map(key => {
    if (CACHE_PREFIXES.some(prefix => key.startsWith(prefix))) return caches.delete(key);
  }));
}

function isIndexUrl(url) {
  const path = url.pathname.replace(/\/+$/, '/');
  const scopePath = scopeUrl.pathname.replace(/\/+$/, '/');
  return path === scopePath || path === scopePath + 'index.html';
}

function isPadAudio(url) {
  return url.pathname.includes('/assets/pads/') && /\.(mp3|m4a|aac|ogg)$/i.test(url.pathname);
}

function isStaticAsset(request, url) {
  return ['style', 'script', 'image', 'font', 'manifest'].includes(request.destination) ||
         /\.(png|jpg|jpeg|webp|svg|ico|json|webmanifest|css|js|woff2?)$/i.test(url.pathname);
}
