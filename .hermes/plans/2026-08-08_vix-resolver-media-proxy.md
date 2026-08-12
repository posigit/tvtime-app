# Fix: vix native playback dead after resolver deploy + sub picker inert

## STATUS: SHIPPED + VERIFIED LIVE (2026-08-08)

## Root cause (proven)
1. Resolver (`posigit/vix` on Railway) resolved signed playlist URLs, but the
   **browser could not fetch them** — Cloudflare 403s `vixsrc.to/playlist/*`
   from any external origin. hls.js failed → `streamFailed` → iframe fallback.
2. Sub picker was inert because `reloadSubsRef` only exists inside the native
   playback effect — with native dead, clicking a picker option saved the
   setting but reload was a no-op. It was a *symptom* of the same root.

## Fix shipped
- `resolver-server/server.js` (+ `posigit/vix` server.js): added `/media`
  byte proxy that re-hosts the whole chain (master → variants → AES key →
  TS segments) through the resolver, which vixsrc accepts. Key behaviors:
  - Rewrites every proxyable host URL in m3u8 bodies to `/media?url=...`
    (suffix-matches `*.vix-content.net` — segments live on subdomains).
  - Unwraps vixsrc's own `https://vixsrc.to/media?url=<inner>` wrappers so
    we never double-proxy (their /media 404s on nested calls).
  - Rewrites `#EXT-X-KEY:URI="/storage/enc.key"` to a proxied path.
  - Byte-safe: buffers via `arrayBuffer()` + latin1 `#EXTM3U` sniff (never
    routes binary through `.text()` — that corrupted AES keys 16→30 bytes).
  - `Readable.fromWeb(upstream.body).pipe(res)` for segments (WHATWG body
    has no `.pipe()`), with `handled` guard so mid-stream errors destroy the
    socket instead of crashing with ERR_HTTP_HEADERS_SENT.
- `app/api/vixsrc/stream/route.ts`: when resolver is set, prefixes the
  resolver base onto the relative `/media?url=...` the resolver now returns.

## Verified (live on Railway, 2026-08-08)
- `GET https://vix-production.up.railway.app/stream?type=movie&id=693134`
  → relative `/media?url=...` ✅
- Master via /media: 9 rewritten URLs ✅
- Audio variant: 2506 rewritten segment URLs ✅
- AES key: exactly 16 bytes binary ✅
- Real TS segment: HTTP 200, 48,320 bytes ✅
- Gates: tsc 0, lint 0, build ✅
- Shipped: resolver commit 31847306 (posigit/vix, auto-deploys Railway),
  app commit 9ffa0ac (Vercel production success)

## Remaining
- User live test: hard-refresh, open movie, Vix source → native hls.js
  controls. Sub picker should swap subs live now.
- thumbnailsUrl is unused by the player (dead field) — no action.
