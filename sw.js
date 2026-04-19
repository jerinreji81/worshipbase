
const CACHE_NAME='worshipbase-pwa-v1';
const APP_SHELL=[
  './',
  './manifest.webmanifest',
  './wb-icon.svg',
  './wb-icon-180.png',
  './wb-icon-192.png',
  './wb-icon-512.png',
  './esv_chapter_package/bible-index.json'
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
  );
});

async function staleWhileRevalidate(request){
  const cache=await caches.open(CACHE_NAME);
  const cached=await cache.match(request);
  const networkPromise=fetch(request).then(response=>{
    if(response && response.ok && request.method==='GET' && new URL(request.url).origin===self.location.origin){
      cache.put(request,response.clone());
    }
    return response;
  }).catch(()=>cached);
  return cached || networkPromise;
}

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);

  if(req.mode==='navigate'){
    event.respondWith(
      fetch(req).then(response=>{
        const copy=response.clone();
        caches.open(CACHE_NAME).then(cache=>cache.put('./',copy));
        return response;
      }).catch(()=>caches.match('./'))
    );
    return;
  }

  if(url.origin===self.location.origin){
    if(url.pathname.endsWith('/bible-index.json') || url.pathname.includes('/esv_chapter_package/bible/')){
      event.respondWith(staleWhileRevalidate(req));
      return;
    }
    if(/\.(?:html|js|css|json|png|svg|webmanifest)$/i.test(url.pathname)){
      event.respondWith(staleWhileRevalidate(req));
    }
  }
});
