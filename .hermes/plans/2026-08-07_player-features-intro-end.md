# tvtime Player — Autoplay-Next + Speed/Volume UI (scoped plan)

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Ship two features selected from the roadmap: (1) **autoplay-next episode** on end, (2) **playback-speed + volume UI controls** to wire up the persistence that already exists in `lib/vix-settings.ts`.

**Architecture:** Both are client-side in `components/vix-player.tsx` plus one small new component each. **Autoplay-Next** hooks the existing `emit("ended")` bridge (single-fire via `endedRef`) and needs next-episode details passed in as a prop (the player itself doesn't know episode numbers beyond `season`/`episode`; the parent that mounts `VixPlayer` has the show data). **Speed/Volume UI** reads/writes the already-implemented `saveVixSettings({speed,volume})` + `video.playbackRate` / `video.volume` (lines 770, 918, 962-966 of `vix-player.tsx`).

**Tech Stack:** React 19, Next 16, hls.js (native path), `lib/vix-settings.ts` (existing localStorage persistence).

---

## Current state (verified from code)

- Speed + volume PERSISTENCE already exists: `loadVixSettings/saveVixSettings` store them; player applies `video.playbackRate = s.speed` & `video.volume = s.volume` and listens to `ratechange`/`volumechange` to re-save (lines 770, 918, 962-966). **What's missing is the UI to change them.**
- **Double-tap seek (B4) is already implemented** — `/10s` taps exist (lines ~380-410). Not part of this build.
- Resume/ended: `endedRef` guard, `RESUME_END_RATIO=0.92`, single `emitPlayed(ended)` + parents mark watched. Autoplay-Next hooks here.
- Player props: `type`, `tmdbId`, `season`, `episode`, `src`, `title`, `onEvent`, `onClose`, `initialPosition`, `autoResume`. NO next-episode data — must be added.

---

## Current player context (verified from code)

- `components/vix-player.tsx` (~46KB, single component). TWO playback paths into one `emit(event)` bridge:
  - **Native**: hls.js or Safari `<video>` — events `play/pause/seeked/ended/timeupdate`.
  - **iframe fallback**: vixsrc embed over `postMessage` (`PLAYER_EVENT` parsed, trusted origin).
- `RESUME_END_RATIO = 0.92` — playback ≥92% = finished, clears bookmark, fires `emit("ended")` once (`endedRef` guard).
- Source toggle `vix | goated` via `switchSource`; reset stream state on switch.
- Resume: `ResumeOverlay` 5s auto-resume; keepalive saves position to `/api/playback`.
- Watch marks: TV eps via `/api/watch`, movies via `/api/movie-watch`.
- Duration source: hls.js `duration` when available; DB fallback `episodes.runtime` / `shows.episodeRuntime` (minutes).
- Known constraint: iframe fallback has no native `timeupdate` granularity — it delivers discrete `PLAYER_EVENT` payloads; any position-based feature must degrade gracefully there.

---

# Part A — Auto intro & end recognition

## A1. Skip Intro / Skip Recap button (heuristic tier — ship first)

**Approach:** Show a floating "Skip Intro" / "Skip Recap" button when the viewer is in the first N minutes, based on *expected intro window* derived from TMDB runtime + a per-show learned skip point.

**Why heuristic first (honest tradeoff):**
- True audio-fingerprint intro detection (Netflix-style) is a real project: WebAudio spectral capture, per-episode fingerprint storage, similarity search. It's the A2 phase.
- Heuristic + crowd-sourcing delivers 80% of the UX value with ~1/10th the build: for most TV (esp. Nigerian/US network shows on vixsrc), intros are a stable 30–90s block near the start, recaps 60–180s. A "Skip" button appearing in that window + remembering the exact timestamp the user skipped = learned marker, shared across users of the same show.

**Mechanics:**
- Player tracks `currentTime` via the existing `timeupdate` bridge.
- If `mediaType === "tv"` and `0 < currentTime < introWindowEnd` (default 180s, or learned), show the button.
- Click → `video.currentTime = skipTo` where skipTo = learned skip point (default 90s) → POST to `/api/skip-points` → future plays of the same show/season get the learned point.
- Crowd-source: DB table `skipPoints(showTmdbId, seasonNumber, skipSeconds, sampleCount)` — take median of recorded user skips.
- Intro window end = min(learned point + 30s, episodeRuntime * 0.4) so the button only lives where an intro plausibly is.

**UI:** floating pill top-right, `Skip Intro →` — matches the ResumeOverlay pattern already in the codebase. Fades out after `introWindowEnd`.

**Files:**
- New: `components/skip-intro-button.tsx`
- New: `lib/player-features.ts` (skip point fetch/cache, defaults, window calc)
- Modify: `components/vix-player.tsx` (render button, handle seek, wire to timeupdate)
- New API: `app/api/skip-points/route.ts` (GET median, POST user skip)
- Schema: `lib/schema.ts` — add `skipPoints` table
- Drizzle migration: `drizzle/`

**Validation:**
- Unit: window math, median aggregation, skipTo defaults per runtime bucket.
- Manual: play any TV ep with an intro → button appears in first 3 min → click skips and remembers; second play of same show uses learned point.
- Gate: `npm run lint`, `npx tsc --noEmit`, `npm run build`.

## A2. Skip Credits / Go To Next button (end-of-episode tier)

**Approach:** Show "Skip Credits" when `currentTime` enters the credits window (last ~4–8% of runtime — reuse the existing `RESUME_END_RATIO` logic as the anchor), and "Next episode →" after `emit("ended")`.

**Mechanics:**
- Credits start estimate: `duration * (1 - CREDITS_RATIO)` where `CREDITS_RATIO = 0.06` default (TV) / `0.10` (movie) — configurable per show via learned skip points later.
- Button → seek to `duration - 2` (past credits but before end so `ended` fires naturally → auto-mark-watched logic unchanged).
- If the ep is already the last of a season, "Next" hides; "Up next" card on ended shows the next ep from `episodes` (already in DB).

**Files:**
- Modify: `components/vix-player.tsx`
- New: `components/skip-credits-button.tsx`
- Optional API reuse: `/api/watch` next-episode prep.

**Validation:**
- Manual: TV ep near end → Skip Credits appears ~6% from end, jumps, `ended` still fires, watched marks.
- Gate: lint + tsc + build.

## A3. True intro detection via client-side audio fingerprinting (upgrade tier — optional, after A1 proves usage)

**Approach:** WebAudio `AnalyserNode` on the hls.js `<video>` element → per-second spectral feature vectors (e.g. 32-bin chroma/energy signature) captured during the first `introWindowEnd` seconds of each episode. Store a compact fingerprint (per-show/season/episode). When an episode's start fingerprint matches the prior episode's start fingerprint, the common block is the intro → compute skipTo = first mismatch. Netflix-class without server processing — all client-side, per-user, aggregated server-side.

**Honest costs:** fingerprint storage (approx 128 floats/sec × 180s ≈ 23k numbers/episode — compress to ~2KB/episode with hashing/quantization), similarity matching on load, capture only while the video element actually plays (privacy: never sent raw audio, only feature vectors). This is a **separate follow-on build** — do NOT start until A1 is shipped and users actually skip.

**Files (future):** `lib/intro-fingerprint.ts`, `app/api/intro-fingerprint/route.ts`, new table `introFingerprints`.

---

# Part B — Other high-value player features (ranked by value/effort)

## B1. Autoplay next episode (highest value, low effort)
- On `emit("ended")` when `mediaType === "tv"` and a next episode exists: show "Up next: <title> in 10…9…" card (Netflix pattern); countdown auto-plays unless user cancels; reuse `endedRef` so it fires once.
- Toggle: `autoplayNext` pref (per-user, `layout-pref.ts` pattern already exists → add `player-pref.ts`).
- Files: `components/up-next-card.tsx`, modify `vix-player.tsx`, `lib/player-pref.ts`, `lib/schema.ts` (`userPlayerPrefs`).

## B2. Playback speed control
- Pure `<video>.playbackRate` (hls.js native + Safari). Button cycles 0.75× / 1× / 1.25× / 1.5× / 2×; persists per-user.
- iframe fallback: no speed control (disabled state).
- Files: `components/playback-speed-button.tsx`, `lib/player-pref.ts`.

## B3. Picture-in-Picture
- `video.requestPictureInPicture()` + native events. Works on hls.js path (same element). Hide in iframe mode.
- Files: modify `vix-player.tsx`, small `pip` button.

## B4. Mobile gestures: double-tap seek (⏪10s / ⏩10s)
- Double-tap left/right half → seek ±10s with a little ripple; respects the same `emit("seeked")` path.
- Files: modify `vix-player.tsx`.

## B5. Keyboard shortcuts
- Space/K = play/pause, ←/→ = ±10s, ↑/↓ = volume, F = fullscreen, M = mute, 0–9 = seek %. Guard against typing in inputs. iframe mode: only space/f (no granular events).
- Files: `lib/keyboard-shortcuts.ts`, modify `vix-player.tsx`.

## B6. Volume slider + remembered volume
- `<input type=range>` overlay; persist in `player-pref`; cross-device via DB.

## B7. Error-state upgrade (fallback chain visibility)
- When vix fails → auto-try goated (already partially exists) → show a clear "source 1/2 failed, trying backup" toast; add a "report broken stream" button that POSTs to a lightweight table so the source rot gets surfaced.
- Files: modify `vix-player.tsx`, `app/api/report-stream/route.ts`, schema `streamReports`.

## B8. Quality selector (hls.js levels)
- List `hls.levels`, show resolution menu, set `hls.currentLevel`. iframe mode hidden. (Low priority until sources expose good renditions — vixsrc often single-rendition; gate behind levels.length > 1.)

## B9. Continue-watching progress rings on cards (backend already has the data)
- `getContinueWatching` already returns `progressPercent` — render a ring on `show-card.tsx` / movie cards. Pure UI.

## B10. Watch session / streaks (social proof)
- Extend existing `watchHistory`/`profile-heatmap` with "current streak" + "this month's minutes". Backend mostly exists; frontend `profile-heatmap.tsx` extension.

---

# Recommended build order (P0 → P1)

| Priority | Feature | Effort | Why |
|---|---|---|---|
| P0 | **B1 Autoplay next** | S | Biggest stickiness win, tiny build |
| P0 | **A1 Skip Intro (heuristic)** | S | The explicit ask; works day one |
| P0 | **A2 Skip Credits / Go To Next** | S | Pairs with A1, low effort |
| P0 | **B5 Keyboard shortcuts** | S | Desktop power-user expectation |
| P1 | **B2 Speed + B6 Volume persist** | S | Cheap, high daily-use |
| P1 | **B4 Double-tap seek** | S | Mobile expectation |
| P1 | **B3 PiP** | S | Natural for a movie app |
| P1 | **B9 Progress rings** | S | Backend ready |
| P2 | **B7 Error-state + report** | M | Trust/ops |
| P2 | **B8 Quality selector** | M | Only if sources improve |
| P2 | **B10 Streaks** | M | Gamification |
| P2 | **A3 Fingerprint intro** | L | Only after A1 proves out |

S = small (<1 session), M = medium (1–2 sessions), L = large (multi-session project).

---

# SCOPED BUILD — what we're implementing now (your 1,3 picks + fixes)

> The roadmap above (A1-A3, B1-B10) stays as reference. This section is the actionable build slate.

## Build 1: Autoplay-Next episode (for TV, only when a next ep exists)

**Confirmed decisions:**
- Autoplay-Next is **ON for TV by default** (not opt-in).
- **Only fires when a next episode exists** — and a season finale IS eligible if the next season has episodes (S+1 E1). Only a true end-of-series (no next ep in this season AND no next season with eps) suppresses the card. Never autoplays into nothing.
- Cancelable 10s countdown card.

**Mechanics:**
- Hook the existing single-fire `emit("ended")` path (native end + 92% auto-complete + iframe `ended`).
- Player gets a new `nextEpisode?: { title, seasonNumber, episodeNumber, stillPath? } | null` prop.
- On ended, if `type==="tv" && nextEpisode && autoplayNext`: render `UpNextCard` (poster + "Next: <title>" + 10s countdown), the countdown ticks, user can Cancel (stops) or it auto-fires.
- Auto-play = emit a NEW `emit("autoplay-next")` event AND call a new `onNextEpisode` callback — the PARENT is responsible for changing the stream source to the next ep (the player must NOT self-navigate/resolve; it doesn't own next-ep src). This keeps the dual-path native/iframe intact.
- The `emit("ended")` currently marks watched + clears bookmark — keep that; autoplay-next just adds navigation after.

**Files:**
- Modify: `components/vix-player.tsx` (new prop, hook `emit("ended")`, render card, timer, emit autoplay-next)
- New: `components/up-next-card.tsx` (poster, title, countdown ring, Cancel)
- Modify: parent that mounts `VixPlayer` (likely `app/(tabs)/initialize`? no — find the player-host component, e.g. `components/show-detail-client.tsx` or a modal) to pass `nextEpisode` and handle `onNextEpisode` (re-resolve next ep source).
- New pref: `autoplayNext` in `lib/vix-settings.ts` (default `true`) — reuse existing localStorage persistence, NO new schema → no migration.
- Determine next episode: from the show episode list already in DB (`episodes` table) — episode `N+1` within `season`, else **next season exists → `season+1` ep 1**; if neither exists → `null` (no card, no autoplay).

**Verification:**
- Manual: play a non-final ep → ends → card shows → auto-plays next; play a season finale → no card; play final ep of series → no card; Cancel stops; pref `autoplayNext:false` → no card.
- Gate: `npm run lint`, `npx tsc --noEmit`, `npm run build`.

## Feature 2: Playback speed + volume UI (data layer already exists)

**Status:** Persistence already implemented in `lib/vix-settings.ts` (speed/volume/muted) and applied in `vix-player.tsx` (lines 770, 918, 962-966). What's MISSING is a control UI to actually change them.

**Build:**
- New `components/playback-speed-button.tsx`: cycles 0.75× / 1× / 1.25× / 1.5× / 2×; writes `video.playbackRate` + `saveVixSettings({speed})`. Hide/disable on iframe mode (no native element).
- New volume control (inline small slider + mute toggle) in the control bar; writes `vanilla video.volume/muted` + `saveVixSettings`. Hide on iframe mode.
- Wire both into the player's existing controls container.

**Verification:** set speed → persists across remount; set volume → persists; restart app → retained. Gate: lint + tsc + build.

## Feature 3 (known bug, open question): double-tap seek on fallback

**Confirmed:** double-tap seek is hard-gated to native (`if (mode !== "native") return;`); on the iframe path it's DEAD. The iframe bridge only RECEIVES `PLAYER_EVENT` — the player never SENDS a control message to the embed.

**Decision:** This is not reliably inside the current build. The embed's inbound postMessage API is not in our code and not documented to us; inventing a seek command risks the trusted-origin bridge. Track it as a known limitation (native = double-tap works; iframe = use embed's own seek). Revisit only if a safe seek protocol for the embed is confirmed. Do NOT fold a guessed command into this build.

## Feature 4: Favorite movies & shows

**Goal:** Let a user mark movies/shows as favorites and surface a Favorites surface. This is the third scope item added before lock.

**Status (verified):** The DATA LAYER ALREADY EXISTS and is import-only dead: `favorite: boolean` on **both** `userShows` (line 109) and `userMovies` (line 131); `userLists` table with `type: 'favorite_shows' | 'favorite_movies' | 'custom'`; the importer mirrors imported favorite-list items onto the `favorite` flag (lines 297-308). What's MISSING is the way to toggle it and browse it:
- **No API route** toggles `favorite` (grep: zero hits in `app/api/`).
- **No UI** to set it (only `import/importer.ts` writes it).
So it's live-but-unusable dead data.

**Approach:** API toggle + heart button on show/movie detail + a Favorites rail/segment, reading the existing `favorite` flag and `userLists`.

**Files:**
- New: `lib/favorites.ts` (favorite row read/toggle helper — set `favorite` on `userShows`/`userMovies`; keep `userLists.favorite_*` in sync or deprecate in favor of the boolean flag — decision below)
- New API: `app/api/favorite/route.ts` — `POST {mediaType, tmdbId, favorite:boolean}`, `GET` current favorites (or reuse library endpoints and add `favorite` to their returned rows)
- New: `components/favorite-button.tsx` (heart toggle on detail pages)
- New: favorites browse surface (`app/…/favorites` or a segment in Library/tabs) — list user's `favorite:true` movies + shows with poster + continue-watching state
- Modify: `components/show-detail-client.tsx` / `movie` detail page + card rail to render `FavoriteButton`

**Open decision to confirm:** **`userLists` vs the `favorite` boolean — pick ONE source of truth.** The importer already sets the boolean from favorite lists. Options:
- (a) **Boolean is truth** (recommended): toggle just flips `favorite`; `userLists` favorite_* become a derived/index view or are left for import-only legacy. Simplest; matches where the importer already lands data.
- (b) **`userLists` is truth**: toggling writes the list item + mirrors to the boolean. More moving parts.
Recommend (a).

**Verification:**
- Manual: heart on movie → appears in Favorites; heart off → removed; heart on show stays across remount; continuation + ratings unaffected; import of a favorites list still populates Favorites.
- Gate: `npm run lint`, `npx tsc --noEmit`, `npm run build`.

---

# Risks, tradeoffs, open questions

1. **iframe fallback limits.** The postMessage path has no fine-grained timeupdate. Every P0/P1 feature must have a "hidden in iframe mode" state (skip button, speed, PiP) or a degraded path (keyboard: only space/F). Verify per feature.
2. **Intro heuristic is a guess per show.** Crowd-sourced medians smooth this but cold shows (first viewer) will guess wrong sometimes — keep the button dismissible and never auto-seek without a click.
3. **Fingerprinting (A3) is the real Netflix feature but the real build.** Client capture is reliable only on the native hls.js path; iframe mode can't fingerprint. That alone is reason to ship A1/A2 first and observe skip usage.
4. **Autoplay + data use.** Autoplay-next costs bandwidth; respect the user pref and keep the 10s cancel window.
5. **Backend schema changes** (`skipPoints`, `userPlayerPrefs`, `streamReports`) need Drizzle migrations + `db:push` on prod — same flow as `playback_positions` before it. Keep additions additive-only.
6. **Open question — "end of episode or movie" intent:** For movies, "skip credits" is the ask; for TV it's "skip intro + credits + autoplay next." Confirm the app should NOT auto-skip anything without a click (this plan assumes click-only, no auto-skip).

---

# Execution notes

- TDD per task; commit per task (local only — no push without explicit approval, per repo rule).
- Gates before any code change ships: `npm run lint`, `npx tsc --noEmit`, `npm run build` (all currently green).
- Player is the most fragile file in the repo (dual-path, postMessage origin trust). Prefer new small components + thin hooks over editing the 1360-line body; keep `emit()` bridge untouched except where a feature genuinely needs a new event type.
