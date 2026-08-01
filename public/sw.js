const CACHE_NAME = "guard-terminal-v1";

const STATIC_ASSETS = ["/gate", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : undefined)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Always bypass the cache for live gate verification/check-in/check-out APIs.
  if (url.pathname.startsWith("/api/gate/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-first for page routes/static assets, falling back to cache when
  // the tablet loses connectivity.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (event.request.method === "GET" && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        return cached ?? new Response("Offline and not cached", { status: 503, statusText: "Offline" });
      }),
  );
});
