# Plan: Goated source cascade — Valenox default → Orbit fallback → Vix last

**Date:** 2026-08-09
**Requested by user:** "set valenox as default, then orbit as the fallback, then vix as the last fallback. but plan first."

## Reality check — two findings that change the premise

### Finding 1: Orbit is NOT down. Valenox is the one blocked — by OUR proxy.
Live probes (dev server, real PoW solves, exact player chain):

| Source | /api/goated/stream | Media proxy | Result |
|---|---|---|---|
| Orbit — Silo S2E2 | 200 | 200, real m3u8 | ✅ **plays** |
| Orbit — Dune 2 | 200 | 200, real m3u8 | ✅ **plays** |
| Valenox — Silo S2E2 | 200, signed URL | **403 `host not allowed`** | ❌ |
| Valenox — Dune 2 | 200, signed URL | **403 `host not allowed`** | ❌ |

The "goated doesn't work" symptom is real but the cause is different from the guess:
- **Valenox resolves fine server-side** (PoW + `/api/resolve` = 200, `availableSources: ["Orbit","Valenox"]`). It fails because the **media proxy allowlist** (`app/api/goated/media/route.ts` `REWRITE_HOSTS`) only contains `cdn.reallyfast.xyz` + `hls.cdn8012.workers.dev`. Valenox serves from **`hls-proxy.cdn8012.workers.dev`** — one missing host = 403 on every Valenox attempt.
- **Orbit currently works end-to-end.** It can be slow (resolver handshake 10-30s under load, seen in dev logs: `goated/stream 200 in 11.4s`), which *feels* like "down" but isn't.

### Finding 2: There is NO source cascade in the player today.
- One resolver call per play (lib/player-stream.ts → `/api/goated/stream` or `/api/vixsrc/stream`).
- On any failure → `setStreamFailed(true)` → iframe embed fallback. There is no Valenox→Orbit→Vix retry chain.
- The player UX toggle is vix↔goated only; it never tries multiple sources automatically, and the goated route defaults to `source=Orbit` with no client side ever sending `Valenox`.

### Valenox media shape (verified — makes the fix tiny)
Fresh Valenox resolve → direct upstream fetch → `200 application/vnd.apple.mpegurl`. Master playlist references **only `hls-proxy.cdn8012.workers.dev`** for every variant (360p/720p), each variant URL carries a self-contained proxy token (`m3u8-proxy.m3u8?p=...`). So **one** new allowlist host unlocks the entire Valenox chain (master → variants → segments all re-route through the same host). Referer-lock is handled inside the upstream URL itself (headers JSON param), not by our proxy's headers.

## Root causes
1. `REWRITE_HOSTS` missing `hls-proxy.cdn8012.workers.dev` → Valenox 403s at the proxy.
2. No automatic source cascade in the player → one dead source kills playback instead of trying the next.

## Work plan (3 small changes, then verify)

### Step 1 — Unblock Valenox in the media proxy (1 line)
Add to `REWRITE_HOSTS` in `app/api/goated/media/route.ts`:
```
"hls-proxy.cdn8012.workers.dev",
```
Also update the route's contract comment (it documents the two Orbit hosts only).

### Step 2 — Server-side default order (tiny)
`app/api/goated/stream/route.ts` currently defaults `source = "Orbit"` when no param is sent and maps only `"Valenox"` → Valenox (anything else → Orbit). Keep this param-driven (it already accepts `Valenox`); the ORDER logic belongs in the client cascade below, not the route. No change needed here unless we want a route-level default flip — see design question.

### Step 3 — Client cascade: Valenox → Orbit → Vix (the real work)
In `lib/player-stream.ts` `resolveStreamPlaylist`:
1. When `source === "goated"`: loop the goated sources in order `["Valenox", "Orbit"]`, calling `/api/goated/stream?source=X` per attempt; return the **first** success (url present). Keep an optional per-source error list in the result for debugging.
2. When the whole goated cascade fails AND the caller is on goated: instead of only `setStreamFailed(true)` (→ iframe), auto-try `vix` as the last native fallback (`/api/vixsrc/stream`), THEN iframe if vix also fails.
3. Guard against loops: a `triedVixInSessionRef` (or mode-based guard) so vix is attempted at most once per play session; and keep the existing manual toggle working.
- In `components/vix-player.tsx` resolution effect (~line 967): handle the new cascade result (if `playlistUrl` → play; if `failed` AND a vix attempt result exists → try it; only after vix fails → `setStreamFailed(true)`). Minimal touch: centralize the order in `player-stream.ts` so the component mostly just consumes the final answer + a `fellBackToVix` flag for the "Try Goated" UI state.

### Step 4 — Verify (live, before telling the user it works)
1. `npx tsc --noEmit` + `npm run lint` + `npm run build` (full gates — repo standard).
2. Scripted chain check (extend `scripts/tmp_chain_valenox.mjs`):
   - Valenox Silo S2E2 + Dune 2 → stream 200 → media proxy **200** (was 403) with m3u8 body after Step 1.
   - Variant URL inside Valenox playlist → proxied → **200** (confirms segments follow the same host).
3. In-browser: dev server, open a goated title → confirm default source resolves Valenox; kill Valenox (or probe with a forced Orbit failure) → confirm Orbit takes over; confirm vix is last; confirm iframe only when all three fail.
4. If a production deploy is wanted after, follow the locked ship workflow (gates → commit → subagent verify → push with user approval).

## Design questions for the user
1. **Default flip**: you said Valenox default. With the cascade, the *default only matters for the first attempt* on every title — after Step 3, Valenox is attempted first everywhere (both movies and TV). Confirm that's desired for ALL titles, or should TV try Orbit first (Orbit has 1080p variants; Valenox tops at 720p)? My read of your instruction: Valenox first, always — flag if you want per-title logic.
2. **Vix auto-fallback scope**: only when goated fully fails (as you said), not when the user manually toggled to goated mid-play? The guard will treat manual-toggle and auto-cascade the same — fine unless you want manual toggles to never auto-leave goated.

## Risks / notes
- Resolver rate limit: each cascade attempt = one PoW solve (`/api/resolve` 429s on 5+ rapid calls). Normal single-title playback = 1 solve; worst case (Valenox + Orbit + Vix all fail) = 3 solves on one play. Acceptable, but the resolveCache in `lib/goated.ts` (60s TTL per source) already softens repeats.
- Valenox segments: master references only the one host, but we verify the **variant** playlist during Step 4 before declaring victory (if a variant ever points at another host, add it to the allowlist the same way).
- tmp probe scripts (`scripts/tmp_probe_valenox.mjs`, `tmp_chain_valenox.mjs`, `tmp_valenox_playlist.mjs`) stay for verification, deleted after.
- Existing `.hermes/plans/2026-08-09_tunnel-login-stuck.md` fix (allowedDevOrigins + AUTH_URL) is unrelated and stays.

## Files touched (estimate)
- `app/api/goated/media/route.ts` — 1 host + comment
- `lib/player-stream.ts` — cascade loop + vix-last-fallback
- `components/vix-player.tsx` — consume cascade result (small)
- scripts tmp probes — verification only, not committed