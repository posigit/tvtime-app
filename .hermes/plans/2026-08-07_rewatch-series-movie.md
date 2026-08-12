# Rewatch: extend to whole-series + movies (non-destructive, sentinel, no migration)

> **Plan mode** — scoped build, surgical. Commit-only, then push for prod test (tvtime flow).

## Design decision (user-confirmed)
**Rewatch is non-destructive.** It clears **only stale resume bookmarks** and bumps the ×N badge. It does **NOT** delete `watchedEpisodes` (so per-episode **ratings survive**), and it does **NOT** touch `watchHistory` (so **old + new watch dates both stay logged** — the user's explicit requirement). The `complete` badge is derived from watched-count, so no watched-row deletion is needed for the badge to work.

## Current state (verified)
- Rewatch exists but per-season only + hidden (tap green ✓ badge on complete season → dialog → `POST /api/rewatch`).
- **Today it's destructive**: deletes `watchedEpisodes` + `playbackPositions` for the season → wipes episode **ratings** (they live on `watchedEpisodes.rating`). This is the bug-fix of this feature.
- `seasonRewatches` table = `(userId, showTmdbId, seasonNumber, count)` — FK to `shows`. Sentinel `seasonNumber=0` = whole-series count (no migration).
- `watchHistory` append-only: movie route never deletes → movie rewatch count = COUNT(movie,tmdbId) rows. TV route deletes on unmark only (not on rewatch).
- Movies have no rewatch at all today.

## Plan (3 parts, one commit, no migration)

### Build 1 — Season rewatch becomes non-destructive (fix the data-loss)
- `POST /api/rewatch` (existing route): **remove** the `watchedEpisodes` delete. Keep `playbackPositions` delete (reset resume). Keep counter bump + show-state recompute (unchanged).
- Ratings survive because watched rows survive. History untouched.

### Build 2 — Whole-series rewatch (TV)
- **Counter**: sentinel `seasonNumber=0` in `seasonRewatches` (reuses table/API, zero migration).
- **API**: extend `POST /api/rewatch` to accept `season: "all"` → delete ALL `playbackPositions` for the show, bump sentinel count, recompute show state (lastSeason/lastEpisode → null only if no other progress).
- **UI**: "Rewatch series" in the show **More menu** → dialog "Rewatch [Show]? Your resume points clear. Badge becomes ×N+1." → clear local resume state, bump series count, re-expand first season. Keep season-badge rewatch too.
- **Discoverability fix**: labeled "Rewatch season" + "Rewatch series" rows in the More menu (no more hidden badge-tap only).

### Build 3 — Movie rewatch
- **Counter**: `COUNT(watchHistory WHERE mediaType='movie' AND tmdbId=?)` — append-only for movies today; no migration.
- **API**: new `POST /api/movie-rewatch { tmdbId }` → delete `playbackPositions` for the movie, **insert one `watchHistory` row** (logs the new rewatch date — old row stays, both dates logged), update `userMovies.watchedAt`.
- **UI**: movie page, when `isWatched`, a compact "Rewatch ×N" button (inline with watch/favorite row) → confirm dialog → clears resume, count increments.

## Files
- `app/api/rewatch/route.ts` — non-destructive + `season: "all"`
- `app/api/movie-rewatch/route.ts` — new
- `components/show-detail-client.tsx` — More-menu "Rewatch season" + "Rewatch series"; generalize `confirmRewatch`
- `app/movie/[id]/page.tsx` — Rewatch button when watched
- `lib/schema.ts` — **no change**

## Verification
- tsc + lint + build green before commit.
- Manual: rewatch a show (resume clears, ratings stay, ×N badge, old+new dates in history), rewatch a movie (same), season rewatch still works.

## Risks / honest limits
- Sentinel `seasonNumber=0` overlaps Specials' S0 label — keep series count in the menu, not the season badge (no visual collision).
- Movie count derives from `watchHistory` rows — if a future feature deletes movie history rows it breaks; documented in the API comment.
- Non-destructive means "complete" seasons stay visually complete after a rewatch (correct — you DID complete them; the ×N badge carries the rewatch signal).