# Pin a movie into the Surprise Me pool (screenshot rig)

Date: 2026-08-10 · Week: 2026-W33 · Pool: 293 (raw, before library filter)

## TL;DR — can we manipulate it? YES, trivially.

The pool is a **dumb Postgres table**, not an API or a smart query. To get
ANY movie into it — even one that normally fails the 7.0/300 gate — you
INSERT one row into `surprise_pool`. No code change, no deploy, ~3 commands,
survives until the next weekly rebuild wipes the table.

## How the pool actually works (verified in source today)

- **Write path**: `lib/surprise-movies.ts` `rebuildSurprisePool()` → cron
  `/api/cron/weekly` → GH Actions `weekly-refresh.yml` (Fri 00:00 UTC).
  Deletes ALL rows, rebuilds from TMDB slices for the current ISO week.
- **Read path**: `getUnseenGreatMoviesPool(excludeIds)` →
  `db.select().from(surprisePool)` — **NO week filter, NO gate re-check**.
  It lists whatever is in the table (minus the user's library), sorted by
  `voteAverage DESC, title ASC`.
- **Schema** (`lib/schema.ts:239`): `surprise_pool(tmdb_id PK, title,
  poster_path, release_date, runtime, vote_average, badge, week, created_at)`.
  No FK to `movies` — the row carries its own poster/title. The card links out
  to `/movie/[tmdbId]` which lazy-ensures the movie row on click.

## The manip

Insert a row for the target tmdbId with high `vote_average` (e.g. 10) so it
sorts to the TOP of the grid. `vote_average` also renders as the score chip,
so pick a value that looks natural — 10.0 looks like a rig; 8.7 reads normal.

```sql
INSERT INTO surprise_pool
  (tmdb_id, title, poster_path, release_date, runtime, vote_average, badge, week)
VALUES
  (603, 'The Matrix', '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg', '1999-03-31', 136,
   8.7, 'Top rated', '2026-W33')
ON CONFLICT (tmdb_id) DO UPDATE
  SET vote_average = 8.7, badge = 'Top rated', week = '2026-W33';
```

The movie appears at grid position based on its vote_average. To force the
TOP slot, give it the highest vote_average in the pool (nominal 10, or
whatever the current max is + 0.1).

## Constraints (the three failure modes)

1. **Library exclusion kills it.** `movies/page.tsx:300` builds
   `libraryIds` from the user's `userMovies` rows and passes it to
   `getUnseenGreatMoviesPool` → rows in the library are filtered OUT of the
   grid. If the target movie is watched/listed, the insert silently does
   nothing visible. **Check first**:
   `SELECT tmdb_id FROM user_movies WHERE user_id = <uid> AND tmdb_id = <target>`
   → if present, either pick a different movie or also DELETE that
   user_movies row (changes library state — ask first).
2. **PK conflict = already in pool.** `ON CONFLICT` handles it (it just
   re-sorts). If the target is already in the pool, no insert needed —
   bump its vote_average to float it up.
3. **Friday's rebuild wipes it.** `rebuildSurprisePool` does
   `db.delete(surprisePool)` unconditionally. The inserted row survives
   until the next cron (Fri 00:00 UTC) or next manual dispatch. For a
   screenshot: plenty. For permanence: see Option B.

## How to run it (no code change, prod DB)

- `DATABASE_URL` is in `~/Desktop/tvtime-data/tvtime-app/.env.local`
  (Railway Postgres, same DB the cron writes).
- One-liner with psql if installed, else node script:
  `npx tsx scripts/pin-movie.ts 603 "The Matrix" ...` — or simplest:
  a small node script using `pg` (already a dep) reading `.env.local`.

## Option B — permanent pins (only if you want it to SURVIVE the rebuild)

Not needed for a screenshot. But if you want a persistent "always show these" 
list that survives weekly rebuilds:

- Add a `surprise_pins` table (tmdb_id PK, user_id, created_at) OR a
  hardcoded `PINNED_TMDB_IDS` array in `lib/surprise-movies.ts`.
- In `rebuildSurprisePool()`, after the delete+insert, append pinned rows
  (fetch their TMDB details once, cache).
- That's a code change + deploy via master — feels like scope creep unless
  you actually want recurring pinned picks. My call: skip it for the
  screenshot; do it only if "surprise me should always include X" becomes
  a real want.

## Deliverable on execution

1. Pick target tmdbId + confirm it's NOT in his library.
2. INSERT row (top slot via vote_average).
3. Verify: `SELECT tmdb_id, title, badge, week FROM surprise_pool WHERE tmdb_id = <target>`.
4. He opens tvtime-app movies tab → movie is at the top of the Surprise grid → screenshot.
5. Cleanup optional: delete the row after the screenshot if he wants the pool
   back to organic (or leave it — it dies Friday anyway).

## Verification checklist

- [ ] Target tmdbId exists on TMDB (poster_path not null — blank tiles are skipped in dedupe)
- [ ] Not in user's library (user_movies) — else filtered at read
- [ ] Inserted with current week key (2026-W33) — cosmetic, no filter uses it
- [ ] vote_average set high enough to hit the target grid position
- [ ] Pool shows it on the movies tab (user confirms visually)