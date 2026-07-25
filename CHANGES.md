# TV Time App — Overhaul Changelog

This document summarizes all changes made during the three-chunk overhaul of the TV Time replacement app.

---

## Chunk 1: Critical fixes, render-first loading, and image optimization

**Commits:**
- `7f99ff0` Chunk 1: critical fixes, render-first loading, and image optimization
- `87fbc66` Fix review findings from Chunk 1
- `4619386` Restore render-first persistence with retry safety

### Authentication & Session Safety
- Added `requireAuth()` helper in `lib/auth.ts` that safely redirects to `/login` when no session exists, replacing unsafe `session!.user.id` assertions across pages.
- Made Auth.js `trustHost` conditional on `AUTH_TRUST_HOST=true` or non-production environments, avoiding a host-header attack vector in production.

### Render-First TMDB Loading
- Added `lib/ensure.ts` with three new helpers:
  - `ensureShow(tmdbId)` — returns show data from DB or fetches from TMDB, renders immediately, persists in background.
  - `ensureMovie(tmdbId)` — same pattern for movies.
  - `ensureEpisodes(tmdbId, numberOfSeasons)` — returns episodes from DB or fetches all seasons from TMDB, renders immediately, persists in background.
- Removed runtime TMDB calls from:
  - `app/(tabs)/shows/page.tsx`
  - `app/show/[id]/page.tsx`
  - `app/movie/[id]/page.tsx`
- Pages now read from the local DB and trigger background fetches only when data is missing.

### Background Persistence Safety
- Initial implementation saved rows in a fire-and-forget style.
- Reviewer identified an FK race: `ensureEpisodes` could try to insert episodes before `ensureShow` finished inserting the parent show row.
- Fixed by adding `saveEpisodesWithRetry()` in `lib/ensure.ts` with exponential backoff, keeping render unblocked while ensuring episodes eventually persist.
- Batched episode inserts into a single query.

### Build & Config
- Added `outputFileTracingRoot: __dirname` to `next.config.ts` to fix workspace root detection.
- Added `images.remotePatterns` for `image.tmdb.org` to support Next.js Image optimization.
- Replaced all `<img>` tags with Next.js `<Image>` across:
  - `app/(tabs)/explore/page.tsx`
  - `app/(tabs)/movies/page.tsx`
  - `app/(tabs)/profile/page.tsx`
  - `app/(tabs)/shows/page.tsx`
  - `app/import/page.tsx`
  - `app/movie/[id]/page.tsx`
  - `app/show/[id]/page.tsx`
  - `components/episode-row.tsx`
  - `components/search-bar.tsx`
  - `components/show-list-item.tsx`

### Bug Fixes
- Fixed login button hydration mismatch with `suppressHydrationWarning`.
- Added `Number.isFinite(tmdbId)` validation in show and movie detail pages to avoid `NaN` errors on invalid URLs.

---

## Chunk 2: Show detail UX and Shows tab overhaul

**Commit:** `69bb133`

### Show Detail UX
- Added `SeasonEpisodeList` client component that manages watched state for all episodes in a season.
- Added **"Mark previous episodes as watched?"** dialog that appears when you mark an episode watched while earlier episodes are still unwatched.
- Extended `/api/watch` to accept a batch `episodes` array and recalculate `userShows.lastSeason`, `lastEpisode`, and `episodesWatched` in one shot.
- Added optional `onToggle` callback to `EpisodeRow` so coordinated state and batch updates live in `SeasonEpisodeList`.

### Shows Tab Overhaul
- Added `LayoutToggle` component and `ShowCard` component.
- Watch list now supports **grid** and **list** views via `?layout=grid|list`.
- Upcoming episodes are now grouped by relative date:
  - Today
  - Tomorrow
  - This week
  - Next week
  - Later
- Added countdown text for each upcoming episode (e.g., "in 3 days", "Tomorrow", "Aired").

---

## Chunk 3: Add shows/movies, empty states, profile redesign, and search

**Commit:** `e881438`

### Add Shows / Movies
- Added `/api/show-follow` endpoint to follow/unfollow shows.
- Added `ShowFollowButton` component.
- Added follow/add buttons directly on the Explore grid for both shows and movies.
- Added `ShowFollowButton` to the show detail page.
- Added `compact` mode to `ShowFollowButton` and `MovieWatchButton` for smaller UI surfaces.

### Empty States
- Redesigned Movies empty state with an icon, heading, description, and CTA.
- Redesigned Movies upcoming empty state with the same treatment.

### Profile Redesign
- Added `LogoutButton` client component using `next-auth/react` `signOut`.
- Redesigned `app/(tabs)/profile/page.tsx`:
  - New header with profile title and notification placeholder.
  - Larger avatar with gradient ring.
  - Compact 4-column stats (Shows, Movies, Episodes, Hours).
  - Quick-action grid: My Shows, My Movies, Import Data, Explore.
  - Improved favorites sections with "See all" links.
  - Added logout button at the bottom.

### Explore Search Enhancements
- Search results now include compact follow/watch buttons so users can add items without leaving search.
- Added "No results for ..." empty state when a search returns nothing.
- Result rows are no longer fully wrapped in a single `<Link>`, allowing independent poster/info/button interactions.

---

## Verification

All chunks pass the production build:

```bash
npm run build --webpack
```

Run the development server with:

```bash
npm run dev
```

---

## Files Added

- `app/api/show-follow/route.ts`
- `components/layout-toggle.tsx`
- `components/logout-button.tsx`
- `components/season-episode-list.tsx`
- `components/show-card.tsx`
- `components/show-follow-button.tsx`
- `CHANGES.md`

## Files Significantly Modified

- `lib/auth.ts`
- `lib/ensure.ts`
- `next.config.ts`
- `app/api/watch/route.ts`
- `app/(tabs)/explore/page.tsx`
- `app/(tabs)/movies/page.tsx`
- `app/(tabs)/profile/page.tsx`
- `app/(tabs)/shows/page.tsx`
- `app/show/[id]/page.tsx`
- `app/movie/[id]/page.tsx`
- `components/episode-row.tsx`
- `components/movie-watch-button.tsx`
- `components/search-bar.tsx`
- `components/show-list-item.tsx`

---

## Parity pass (post-review vs original plan + `/snapshots`)

Closes gaps found when comparing Chunks 1–3 to the original Phases 1–8 plan and the original TV Time screenshots in `../snapshots/`.

### Shows Upcoming (Phase 4)
- Calendar date headers (`3 JUL 2026` style) instead of relative buckets.
- **Premiere** badge on E01; **Latest** badge on most-recent already-aired row per show.
- Future episodes show a countdown chip instead of mark-watched.
- Already-aired unwatched episodes keep mark-watched.
- `computeUpcomingEpisodes` now includes future air dates plus recently aired (last 7 days) so users can scroll back.

### Movies empty (Phase 6)
- Popcorn-style empty illustration + copy + **BROWSE ALL MOVIES** when watchlist/upcoming is empty.

### Profile (Phase 7)
- Snapshot-like layout: centered username header, lists CTA, horizontal **Shows** / **Favorite shows** / **Movies** / **Favorite movies** carousels.
- Personal stats only (no social following/followers/feed — intentional non-goal).

### Hardening
- `ensure.ts`: background parent-show ensure before episode insert; on FK failure re-insert parent then retry episodes.
- `search-bar.tsx`: module-level LRU cache (20 queries) for debounced TMDB search.

### Intentional non-goals
- No social FEED / GROUPS / ACTIVITY (original Explore feed often fails; out of scope).
- Movies Upcoming remains an empty stub until a real release-date pipeline is added.
- Username rename: run `npx tsx scripts/rename-user.ts admin posi` when needed (script already exists).

---

## Watchlist semantics, episode-catalog freshness, profile density, and ratings

### Movie watchlist fixes (auto-watch bug)
- **Root cause:** `MovieWatchButton` was a single watched/unwatched toggle — the button labeled "Want to Watch" actually saved `watched`, and on Explore the button vanished after one tap, making watchlist-add impossible there.
- Rewrote `components/movie-watch-button.tsx` with two distinct actions and three variants:
  - Watchlist toggle (`null ↔ want_to_watch`) — never marks watched.
  - Watched toggle (`watched ↔ want_to_watch`), plus Remove, on the detail page (`variant="full"`).
  - `variant="overlay"` (round +/✓ for poster corners) and `variant="compact"` (search rows) are add-to-watchlist only; once in the library they show a static ✓.
- `/api/movie-watch` now accepts `status: null` → deletes the row (removal from library possible for the first time) and validates input.
- Explore `PosterTile`: replaced the full-width bottom action bar (oversized on mobile) with a small circular +/✓ overlay on the poster's top-right corner.
- `/api/search` joins `userMovies`/`userShows` for returned ids; search results now show real library state instead of hardcoded empty state.
- Movie detail page: explicit `[Want to Watch]` / `[Mark Watched]` buttons.
- `ShowFollowButton` gained matching `overlay`/`compact` variants (follow-only on small surfaces; unfollow stays on the show page menu because it deletes watch history).

### Episode/show catalog freshness (shows not re-entering the Watch List)
- **Root cause:** `ensureEpisodes()` returned cached catalogs forever (`if (existing.length > 0) return existing`) and `persistShow()` was `onConflictDoNothing`, so episodes/seasons TMDB added after first cache never entered the DB — shows computed "caught up" and silently dropped from the Watch List.
- `persistShow` now upserts show metadata (status, season counts, last air date, …).
- Episode saves now upsert title/overview/airDate/stillPath/runtime (schedule changes land).
- New background `refreshShowCatalog()`: refetches show details + only the seasons that can change (`maxCachedSeason..numberOfSeasons`).
- `ensureEpisodes()` keeps render-first behavior but kicks a deduped background refresh when the cache is >24h old and the show is still alive (Returning Series / In Production / Planned). Result: a released unwatched episode re-enters the Watch List automatically.

### Profile density
- `PosterCarousel` posters changed from fixed `h-40 w-28` to responsive `aspect-[2/3] w-[calc((100vw-3.5rem)/4)]` — exactly 4 posters across on mobile (matches original TV Time).

### Ratings (5 stars, half steps)
- Storage: integers **1–10** (= 0.5–5 stars × 2) in the existing `user_movies.rating` and `watched_episodes.rating` columns — zero schema changes. Show-level rating intentionally pended (TV Time model: rate episodes/movies).
- New `components/star-rating.tsx`: `StarRatingInput` (half-star hit zones; tap current value to clear), `StarRatingDisplay`, `RatingBadge` (poster chip), connected `MovieRating` and `EpisodeRating` controls.
- New `POST /api/rate` (`kind: "movie" | "episode"`, `rating: 1–10 | null`) — gated: movie must be in library, episode must be watched.
- UI: movie detail rating control; watched-episode rows get a ★ chip with popover picker; show detail header shows a **derived show score** (avg of your episode ratings, read-only); rating badges on Movies-tab and profile-list poster grids.
- Note: imported TV Time emotion votes (`episode_reactions`/`movie_reactions`, 28 + 33 rows) are preserved but untouched — emoji reactions remain a separate roadmap item.

### Verification
- `npm run build --webpack` passes; routes smoke-tested (401 auth gates, `/login` 200).
- Freshness verified against production DB: stale "Rick and Morty" cache triggered a background refresh that upserted season 9; "Breaking Bad" (Ended) was correctly skipped.
