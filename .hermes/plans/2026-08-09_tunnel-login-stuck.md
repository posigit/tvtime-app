# Fix: Login button stuck on "Loading..." via outray tunnel

**Date:** 2026-08-09
**Repro URL:** https://soft-naturely.outray.app/login
**Reproduced:** yes — on localhost:3000 AND through the tunnel (desktop browser + phone screenshots)
**RESOLVED:** 2026-08-09 — see "Resolution" at the bottom.

## Root cause (two independent server-side defects — NOT the tunnel)

### 1. Next 16 dev-mode HMR origin guard blocks tunnel connections → hydration never runs (the "Loading..." freeze)
- `app/login/page.tsx:65` renders `"Loading..."` only when `mounted === false` (SSR snapshot of `useSyncExternalStore`). The button only flips to "Sign In" after client hydration runs.
- Next 16 dev (Turbopack) **refuses cross-origin requests to dev-only endpoints** unless the origin is in `allowedDevOrigins` (default = localhost only). The HMR WebSocket upgrade (`/_next/webpack-hmr`) is one of those guarded endpoints: with a tunnel Origin header it returns **502**, with `Origin: http://localhost:3000` it returns **101 Switching Protocols**.
- No WS → Turbopack runtime never executes app modules → React never hydrates → zero console errors, button frozen. Signature: *page loads, all chunks 200, no JS errors, nothing hydrates*.
- This is a **dev-mode-only dependency**: `next start` (production build) has no HMR socket requirement.

### 2. Auth.js v5 derives the callback URL from AUTH_URL / x-forwarded-host — and Next dev normalizes host to localhost:3000 (broken login even after hydration fix)
- Probe: `GET /api/auth/csrf` through the tunnel returned `__Secure-authjs.callback-url=https://localhost:3000`.
- `@auth/core/lib/utils/env.js` `createActionURL`: uses `AUTH_URL ?? NEXTAUTH_URL` first, else `x-forwarded-host ?? host`. Next dev injects `x-forwarded-host: localhost:3000` itself, so even sending the real tunnel Host header to the origin still produced a localhost:3000 callback URL.
- Consequence: login would issue session cookies bound to `localhost:3000` → phone gets a session it can't use.

## Verified facts
| Check | Result |
|---|---|
| Tunnel reachability | HTTP 200, 1.3s |
| localhost:3000 hydration | WORKS ("Sign In") |
| Tunnel hydration (pre-fix) | STUCK ("Loading...", disabled) |
| WS /_next/webpack-hmr via tunnel, tunnel Origin | **502** (origin guard) |
| WS /_next/webpack-hmr via tunnel, localhost Origin | 101 ✓ |
| Auth callback-url cookie via tunnel | localhost:3000 (Next dev host normalization) |
| JS console errors | none |

## Resolution (implemented 2026-08-09, verified live)
1. **`next.config.ts`** — added `allowedDevOrigins: ["soft-naturely.outray.app", "*.outray.app", "*.trycloudflare.com"]` (wildcards supported).
2. **`.env.local`** — added `AUTH_URL="https://roof-leading-gis-agrees.trycloudflare.com"` (Auth.js v5 uses it as the authoritative base URL). Backup: `.env.local.bak-before-tunnel-fix`.
3. Killed the stale `next dev` (PID 4928/19520), started fresh (`npx next dev`).
4. Swapped tunnel: killed `outray` (PID 14760), running `cloudflared tunnel --url http://localhost:3000` (cloudflared proxies WS + preserves Host; outray rewrote Host → also broken).
5. Verified end-to-end through the tunnel:
   - WS with tunnel Origin: **101 Switching Protocols** ✓
   - callback-url cookie: `https://roof-leading-gis-agrees.trycloudflare.com` ✓
   - Page hydrates: button = "Sign In", Dev Tools rendered ✓
   - Real login with admin creds: 302 + `__Secure-authjs.session-token` for the tunnel domain ✓
   - Session validates: `{"user":{"name":"posi","id":"a14978c9..."}}` ✓

⚠️ **KNOWN GOTCHA:** `AUTH_URL` is pinned to the current cloudflared URL. Quick tunnels get a NEW random URL on restart — if the tunnel restarts, `AUTH_URL` in `.env.local` must be updated or login breaks again. Use a named tunnel for a stable URL, or update the env on each restart.