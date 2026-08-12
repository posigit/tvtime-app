# Fallback Player Parity — the probe's verdict

> **Verdict (probe, 2026-08-07):** External control of the vixsrc iframe player is **not possible**. The fallback embed is a **JWPlayer** inside a token-signed `/embed/{id}` iframe, nested inside the `/tv` page the app embeds, and it is **cross-origin to the app**. Tested 12+ postMessage command shapes into both the `/tv` frame and the `/embed` frame directly (SEEK, PLAYER_SEEK, PLAYER_CONTROL, PLAYER_EVENT, CMD, etc.) — **zero moved `currentTime`**. JWPlayer's API (`window.jwplayer()`) exists but is only callable *inside* the embed's own window, which the app cannot reach cross-origin. There is no inbound control protocol.
>
> **Therefore: you cannot bolt speed/seek/volume onto the fallback. The only path to full player control is the native hls.js path** — which the app already has (`/api/vixsrc/stream` resolves the m3u8 via `VIX_RESOLVER_URL`, and hls.js plays it natively). The real fix is: **make native the default for your content**, not fight the iframe.

---

## Why the fallback can't be controlled (evidence)
1. **Two iframes deep:** app → `vixsrc.to/tv/{id}/{s}/{e}` → `vixsrc.to/embed/{id}?token=…` (JWPlayer inside).
2. **Cross-origin wall:** the app's origin (vercel.app) is not vixsrc.to — the JWPlayer API object is unreachable from our code.
3. **Zero seek response:** 12+ candidate messages posted to both frames, measured embed `currentTime` — unchanged. No inbound protocol exists.
4. The embed only *sends* `PLAYER_EVENT` outward (already parsed by `lib/vixsrc.ts`). It accepts nothing in.

---

## What this means for the app

**The feature your fallback genuinely lacks (speed/seek/volume) is blocked by the embed, not by our code.** No amount of wiring in `vix-player.tsx` fixes it.

**The real move — two options:**

### Option A (recommended): Make native hls.js the working default for your content
- The app already has the native resolver (`/api/vixsrc/stream` → m3u8 via `VIX_RESOLVER_URL`). It currently falls back to iframe when native fails on your network/machine.
- Work: diagnose *why* you land on fallback (network? Cloudflare? resolver-service down?) and fix it so native resolves reliably → you get double-tap seek, speed, volume, and the new Up-Next card on the path you actually use.
- This delivers every feature in this thread on your default player.

### Option B (fallback-only cosmetic): accept the embed's own controls
- The JWPlayer iframe already has its own native controls (its own volume, its own fullscreen). We can't add ours on top.
- The only safe improvement is labeling ("this source uses its own player controls") — no functional parity.

---

## Files touched (Option A — the recommended build)
- `components/vix-player.tsx` — prefer-native logic: reduce iframe fallback (e.g. only if stream resolution truly fails; longer retry; clearer error state)
- `app/api/vixsrc/stream/route.ts` — resolver path audit (is `VIX_RESOLVER_URL` set on prod? is the resolver-service alive?)
- `components/show-detail-client.tsx` / `movie-vix-button.tsx` — pass `source="vix"` (native-first) consistently
- No schema/API/DB changes.

---

## Open questions for the user (now that the full picture is known)
1. **Option A or B?** A = invest in making native your default (full control, real fix). B = accept the iframe's own controls and stop trying.
2. If A: do you know *why* you usually land on fallback — is native broken on your network, or did you choose iframe? Check `VIX_RESOLVER_URL` on Vercel.
3. If A: is the resolver-service (resolver-server/) deployed and healthy? That's the most likely single point of failure for native.

## The capability matrix we're targeting

| Feature | Native (works) | Fallback status | Key constraint |
|---|---|---|---|
| Double-tap ±10s seek | ✅ (`seekBy`, `handleTap` line 400 gated) | ❌ dead | needs embed seek command OR seek via reload w/ `startAt` |
| Playback speed | ✅ (new button, `video.playbackRate`) | ❌ not in embed | needs embed rate command |
| Volume | ✅ (native `<video>.controls`) | ⚠️ embed has own controls | embed's own slider exists in-iframe; external control needs a command |
| Up-next / autoplay | ✅ (host-level, works both paths) | ✅ already host-level | no change |
| Resume | ✅ | ✅ (`startAt` param) | unchanged |

---

## Phase 0 — PROBE the embed's inbound protocol (investigation, no code)

**Objective:** determine if the vixsrc embed (`https://vixsrc.to/tv/{id}/{s}/{e}`) accepts postMessage control commands, and in what exact shape.

**How (browser console / a tiny throwaway probe, not committed):**
1. Open the actual embed in a real browser (nhyd see new/replay/seek behavior).
2. From the parent console, send candidate messages to `iframe.contentWindow`:
   - `{type:"SEEK", time:120}` / `{type:"seek", time:1}` / `{type:"PLAYER_SEEK", time}`
   - `{type:"PLAYER_CONTROL", action:"seek", value:120}`
   - `{type:"PLAYER_EVENT" ...}` variants
   - Standard-ish patterns from vixsrc-ish embed families.
3. Observe: does the video position jump? Does doubling taps advance? Does playbackRate respond to any message? Check the embed's own `window` for an exposed API (some embeds attach a global, e.g. `window.player.seek()`).

**Decision gate after probe:**
- **If** a seek command works → implement seek+speed+volume via postMessage → full parity.
- **If seek only via reload `startAt`** → implement double-tap seek by **remounting with `startAt=(current±10)`** (single near-native-path). Reload-on-seek is ~1–2s and loses buffered frames — acceptable for ±10s but NOT for scrubbing. Speed/volume still blocked.
- **If nothing responds** → the fallback's capabilities are inherently limited to what the embed exposes. Then the honest fix is **cross-path parity for what's possible** + a clear "seek/speed not available on this source" state, OR investigate upgrading the fallback to a native-hls source (vixsrc has a no-iframe stream API? check — `startAt, primaryColor` params suggest a native embed config; determine if the embed routes to actual hls segments that we could play via the existing hls.js path).

**Files (Phase 0, throwaway only):**
- `scripts/probe-vix-embed.html` (local probe, NOT committed) — or just DevTools console on the live embed.

---

## Phase 1 — Implement parity (once the protocol is known)

### Seek (double-tap)
- If inbound seek confirmed: in `seekBy` (line ~260), remove the `if (mode !== "native") return;` gate; in iframe mode, dispatch the confirmed command to `iframeRef.current.contentWindow`.
- If reload-`startAt` only: handler sets a "pending seek" → close iframe → re-open with `startAt`. Do NOT relay through the live-point dedup that could double-fire.
- Keep `tapCue` visual (already mode-agnostic) so the +10/−10 ripple shows on both paths.

### Speed (playback rate)
- If inbound rate command exists: add the speed button (goes brown today) to iframe mode; dispatch `rate` command.
- If not: **speed is not possible in iframe mode** — the embed controls its own playback. Document; do not fake it.

### Volume
- The embed has its own in-iframe volume control (it renders its own `<video>` + controls). External mute/slider needs a command. Confirm via probe. If no command, **leave volume to the embed's own controls** — document it rather than bolt a dead UI on.

### Consistency guard
- Any newly-sent message must be **origin-checked both ways**: only send to `iframeRef` whose `src` is a vixsrc origin; only act on confirmed incoming events (already in place). Reuse `isVixPlayerOrigin`.

---

## Phase 2 — Parity UI (independent of probe result, safe to ship)

These don't need an embed command — they're cosmetic/positional:

1. **Speed button** — show it in iframe mode; if no rate command exists, disable with a "not supported on this source" tooltip rather than hiding (user currently sees nothing at all — a disabled control is strictly better information).
2. **Double-tap cue** — ensure the +10/−10 ripple + seekBy path is consistent; wire the actual seek only if a command exists.
3. **Consistent embed vs native labeling** — the player already shows "VixSrc" vs "Goated · Orbit". Make the fallback explicitly say "source video has its own controls" in the empty-controls area so the user isn't hunting for controls that don't exist.

---

## Files touched (Phase 1+2)
- `components/vix-player.tsx` — add dispatch helper `sendToEmbed(msg)`, remove native-only gates where a command exists, gate-flag non-commandable features with a tooltip
- `lib/vixsrc.ts` — add `sendVixCommand(iframe, command)` + the confirmed command shapes + `parse/validate` for response if any
- `lib/vix-settings.ts` — already persists speed/volume; no change needed
- No schema/API/DB changes.

---

## Verification (after implementation)
- **Fallback (the user's real path):** open any tv/movie in fallback → double-tap seek jumps; speed control present (enabled if command works / visibly disabled+explained if not); resume still works; watch-completion still marks; up-next still autoplays.
- **Native unaffected:** hls.js path still full-featured.
- **Gates:** `npx tsc --noEmit`, `npm run lint`, `npm run build` all green before commit.

---

## Risks / honest limits
1. **We may simply not be able to control the embed.** If no inbound command exists, "parity" for seek/speed is physically blocked by cross-origin — the total choice is then: (a) document the limitation well, or (b) move toward playing the *source's native hls* via the existing hls.js path (so the whole app controls it). Option (b) is a larger project and may or may not be feasible for vixsrc; the probe should reveal whether the embed exposes underlying hls segments to a parent.
2. **No guessing a seek protocol.** Phase 1 depends 100% on Phase 0 finding the real shape. If we can't confirm, we report honestly rather than emit a payload that breaks origin-trust.
3. **User reality**: the user runs fallback by default. If the embed is a black box, the highest-value move may be **"why is fallback the default at all"** — if vixsrc exposes a stream-capable endpoint, falling the user onto the native path changes the whole equation. Investigate that in Phase 0 too.

## Open questions for the user
1. When the embed can't be externally sought, is a **reload-with-startAt** double-tap (≈1–2s) acceptable, or is it worse than nothing? (Prefer asking once we know if a real seek command exists.)
2. If cross-origin blocks speed/volume control entirely, is the acceptable outcome "document & rely on the embed's own control," or should we prioritize migrating your default to the **native hls.js** path so you keep full control?