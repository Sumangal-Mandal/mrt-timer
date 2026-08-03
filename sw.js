const CACHE = "mrt-cycle-v2";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];
const WORKOUTS_MANIFEST = "./workouts/index.json";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll([...SHELL, WORKOUTS_MANIFEST]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // workouts/index.json → network-first so new workouts appear immediately,
  // fall back to cache when offline.
  if (url.pathname.endsWith("workouts/index.json") || url.pathname.includes("/workouts/")) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            caches.open(CACHE).then(c => c.put(req, res.clone())).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // App shell → cache-first
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone())).catch(() => {});
      return res;
    }))
  );
});
