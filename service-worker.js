const STOCKSYNC_CACHE = "stocksync-pwa-20260728-logo-pdf-editor-match-v1";
const CORE_ASSETS = [
  "/manifest.webmanifest",
  "/pwa.js?v=20260721-valor-equipamento-orcamento",
  "/styles.css?v=20260721-card-altura-historico",
  "/app.js?v=20260721-valor-equipamento-orcamento",
  "/14-orcamentos.html",
  "/orcamentos-offline.css?v=20260728-logo-pdf-editor-match",
  "/orcamentos-offline.js?v=20260728-logo-pdf-editor-match",
  "/assets/pwa-icon-192.png",
  "/assets/pwa-icon-512.png",
  "/assets/logo-stocksync-icon.png",
  "/assets/logo-stocksync-login.png",
  "/assets/logo-avila-eventos.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STOCKSYNC_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS.map((url) => new Request(url, { cache: "reload" }))))
      .catch(() => null)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== STOCKSYNC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && !url.pathname.endsWith(".html")) {
          const copy = response.clone();
          caches.open(STOCKSYNC_CACHE).then((cache) => cache.put(request, copy)).catch(() => null);
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("/01-login.html")))
  );
});
