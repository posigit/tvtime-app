/* TV Time service worker
 *
 * Goals:
 * - Cache hashed Next static assets (fast repeat loads)
 * - Stale-while-revalidate TMDB posters (snappy grids, offline-ish images)
 * - Never long-cache personalized HTML / RSC / API (always fresh when online)
 * - Offline: simple fallback page, not a stale watchlist
 *
 * Bump VERSION when changing strategies so activate() purges old caches.
 */
const VERSION = "4";
const SHELL_CACHE = `tvtime-shell-v${VERSION}`;
const STATIC_CACHE = `tvtime-static-v${VERSION}`;
const IMAGE_CACHE = `tvtime-images-v${VERSION}`;

const ALL_CACHES = [SHELL_CACHE, STATIC_CACHE, IMAGE_CACHE];

/** App shell only — not personalized tab HTML */
const PRECACHE_URLS = [
  "/offline.html",
  "/manifest.json",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
  "/avatars/profile.jpg",
];

const IMAGE_CACHE_MAX = 250;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !ALL_CACHES.includes(key))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // --- Cross-origin: only TMDB images ---
  if (url.origin !== self.location.origin) {
    if (isTmdbImage(url)) {
      event.respondWith(staleWhileRevalidateImage(request));
    }
    return;
  }

  // --- Never intercept / cache these (auth, mutations, live data) ---
  if (shouldBypass(url, request)) {
    return;
  }

  // --- Document navigations: network-first, offline shell fallback ---
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // --- Next.js hashed build assets: cache-first ---
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // --- Icons / avatar / manifest / offline page: cache-first ---
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/avatars/") ||
    url.pathname === "/manifest.json" ||
    url.pathname === "/offline.html" ||
    url.pathname === "/favicon.ico"
  ) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // Everything else same-origin (RSC, data, etc.): network only — do not cache
});

function isTmdbImage(url) {
  return (
    url.hostname === "image.tmdb.org" &&
    (url.pathname.startsWith("/t/p/") || url.pathname.includes("/t/p/"))
  );
}

function shouldBypass(url, request) {
  if (url.pathname.startsWith("/api/")) return true;
  // Next App Router flight / RSC payloads — personalized & version-sensitive
  if (url.searchParams.has("_rsc")) return true;
  if (request.headers.get("RSC") === "1") return true;
  if (request.headers.get("Next-Router-Prefetch") === "1") return true;
  if (request.headers.get("Next-Router-State-Tree")) return true;
  return false;
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    // Do NOT cache HTML — watchlist/profile change constantly
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (
      (await cache.match("/offline.html")) ||
      new Response("Offline", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      })
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (
      cached ||
      new Response("", { status: 504, statusText: "Offline" })
    );
  }
}

async function staleWhileRevalidateImage(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(async (response) => {
      // ok or opaque (no-cors image loads)
      if (response && (response.ok || response.type === "opaque")) {
        await cache.put(request, response.clone());
        trimCache(IMAGE_CACHE, IMAGE_CACHE_MAX);
      }
      return response;
    })
    .catch(() => cached);

  return cached || networkPromise;
}

/** Drop oldest entries when over max (FIFO by keys() order) */
function trimCache(cacheName, maxItems) {
  // Fire-and-forget; don't block the image response
  caches.open(cacheName).then(async (cache) => {
    const keys = await cache.keys();
    if (keys.length <= maxItems) return;
    const extra = keys.length - maxItems;
    await Promise.all(keys.slice(0, extra).map((key) => cache.delete(key)));
  });
}
