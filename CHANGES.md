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
