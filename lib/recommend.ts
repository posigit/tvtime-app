import { db } from "./db";
import {
  movies,
  shows,
  userMovies,
  userShows,
  watchedEpisodes,
} from "./schema";
import {
  getMovieRecommendations,
  getTvRecommendations,
  type TmdbMediaCard,
} from "./tmdb";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

/**
 * How often personal "Because you watched" seeds advance.
 * 1h → ~24 rotations/day so Explore keeps changing when you re-open it.
 */
const ROTATION_MS = 60 * 60 * 1000;
/** Pull this many candidates for rotation. */
const SEED_POOL = 8;
/**
 * Max "Because you watched X" rails on Explore.
 * Keep this low — a mixed "For you" rail covers the rest.
 */
const BECAUSE_RAILS_MAX = 2;

type Seed = { tmdbId: number; title: string };

/**
 * Stable-ish rotation: advances every ROTATION_MS, offset by userId so
 * different accounts don't all show the same seed at the same hour.
 */
export function rotationOffset(
  userId: string,
  poolSize: number,
  periodMs: number = ROTATION_MS
): number {
  if (poolSize <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  const slot = Math.floor(Date.now() / periodMs);
  return (slot + hash) % poolSize;
}

/** Pick `count` items from `pool`, starting at a rotating offset (wraps). */
export function pickRotated<T>(
  pool: T[],
  count: number,
  offset: number
): T[] {
  if (pool.length === 0) return [];
  if (pool.length <= count) return pool;
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    out.push(pool[(offset + i) % pool.length]);
  }
  return out;
}

/**
 * "Because you watched…" rails from highest-rated / recent titles,
 * via TMDB recommendations, excluding library.
 *
 * Seeds rotate lightly through the day (~every 4h) across a top pool of 6,
 * so Explore doesn't lock on a single title forever.
 */
export async function getBecauseYouWatched(
  userId: string,
  limit = 18
): Promise<{ seedTitle: string; items: TmdbMediaCard[] }[]> {
  const ownedShowIds = new Set(
    (
      await db
        .select({ tmdbId: userShows.tmdbId })
        .from(userShows)
        .where(eq(userShows.userId, userId))
    ).map((r) => r.tmdbId)
  );
  const ownedMovieIds = new Set(
    (
      await db
        .select({ tmdbId: userMovies.tmdbId })
        .from(userMovies)
        .where(eq(userMovies.userId, userId))
    ).map((r) => r.tmdbId)
  );

  const topShows = await db
    .select({
      tmdbId: watchedEpisodes.showTmdbId,
      title: shows.title,
    })
    .from(watchedEpisodes)
    .innerJoin(shows, eq(shows.tmdbId, watchedEpisodes.showTmdbId))
    .where(
      and(
        eq(watchedEpisodes.userId, userId),
        isNotNull(watchedEpisodes.rating)
      )
    )
    .groupBy(watchedEpisodes.showTmdbId, shows.title)
    .having(sql`count(*) >= 3`)
    .orderBy(desc(sql`avg(${watchedEpisodes.rating})`))
    .limit(SEED_POOL);

  let movieSeeds: Seed[] = await db
    .select({
      tmdbId: userMovies.tmdbId,
      title: movies.title,
    })
    .from(userMovies)
    .innerJoin(movies, eq(movies.tmdbId, userMovies.tmdbId))
    .where(
      and(
        eq(userMovies.userId, userId),
        eq(userMovies.status, "watched"),
        isNotNull(userMovies.rating)
      )
    )
    .orderBy(desc(userMovies.rating), desc(userMovies.watchedAt))
    .limit(SEED_POOL);

  if (movieSeeds.length === 0) {
    movieSeeds = await db
      .select({
        tmdbId: userMovies.tmdbId,
        title: movies.title,
      })
      .from(userMovies)
      .innerJoin(movies, eq(movies.tmdbId, userMovies.tmdbId))
      .where(
        and(eq(userMovies.userId, userId), eq(userMovies.status, "watched"))
      )
      .orderBy(desc(userMovies.watchedAt))
      .limit(SEED_POOL);
  }

  // Fallback show seeds: most watched episodes if no ratings
  let showSeeds: Seed[] = topShows;
  if (showSeeds.length === 0) {
    showSeeds = await db
      .select({
        tmdbId: watchedEpisodes.showTmdbId,
        title: shows.title,
      })
      .from(watchedEpisodes)
      .innerJoin(shows, eq(shows.tmdbId, watchedEpisodes.showTmdbId))
      .where(eq(watchedEpisodes.userId, userId))
      .groupBy(watchedEpisodes.showTmdbId, shows.title)
      .orderBy(desc(sql`count(*)`))
      .limit(SEED_POOL);
  }

  // Prefer one TV seed + one movie seed (max 2 "Because you watched" rails)
  const showPick = pickRotated(
    showSeeds,
    1,
    rotationOffset(userId, showSeeds.length)
  )[0];
  const moviePick = pickRotated(
    movieSeeds,
    1,
    rotationOffset(userId + ":m", movieSeeds.length)
  )[0];

  const rails: { seedTitle: string; items: TmdbMediaCard[] }[] = [];
  const seen = new Set<string>();

  if (showPick) {
    try {
      const recs = await getTvRecommendations(showPick.tmdbId);
      const items = recs
        .filter((r) => !ownedShowIds.has(r.id))
        .filter((r) => {
          const k = `tv:${r.id}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, limit);
      if (items.length > 0) {
        rails.push({ seedTitle: showPick.title, items });
      }
    } catch {
      /* skip */
    }
  }

  if (moviePick && rails.length < BECAUSE_RAILS_MAX) {
    try {
      const recs = await getMovieRecommendations(moviePick.tmdbId);
      const items = recs
        .filter((r) => !ownedMovieIds.has(r.id))
        .filter((r) => {
          const k = `movie:${r.id}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, limit);
      if (items.length > 0) {
        rails.push({ seedTitle: moviePick.title, items });
      }
    } catch {
      /* skip */
    }
  }

  // If we only got movies or only shows, fill second slot from the other pool
  if (rails.length < BECAUSE_RAILS_MAX && showSeeds.length > 1) {
    const alt = pickRotated(
      showSeeds.filter((s) => s.tmdbId !== showPick?.tmdbId),
      1,
      rotationOffset(userId + ":alt", Math.max(1, showSeeds.length - 1))
    )[0];
    if (alt) {
      try {
        const recs = await getTvRecommendations(alt.tmdbId);
        const items = recs
          .filter((r) => !ownedShowIds.has(r.id))
          .filter((r) => {
            const k = `tv:${r.id}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .slice(0, limit);
        if (items.length > 0) rails.push({ seedTitle: alt.title, items });
      } catch {
        /* skip */
      }
    }
  }

  return rails.slice(0, BECAUSE_RAILS_MAX);
}

/**
 * Single mixed "For you" rail — recommendations from several seeds,
 * interleaved TV + movies, excluding library. Less repetitive than
 * many "Because you watched" rows.
 */
export async function getForYouMix(
  userId: string,
  limit = 16
): Promise<TmdbMediaCard[]> {
  const ownedShowIds = new Set(
    (
      await db
        .select({ tmdbId: userShows.tmdbId })
        .from(userShows)
        .where(eq(userShows.userId, userId))
    ).map((r) => r.tmdbId)
  );
  const ownedMovieIds = new Set(
    (
      await db
        .select({ tmdbId: userMovies.tmdbId })
        .from(userMovies)
        .where(eq(userMovies.userId, userId))
    ).map((r) => r.tmdbId)
  );

  const showSeeds = await db
    .select({
      tmdbId: watchedEpisodes.showTmdbId,
      title: shows.title,
    })
    .from(watchedEpisodes)
    .innerJoin(shows, eq(shows.tmdbId, watchedEpisodes.showTmdbId))
    .where(eq(watchedEpisodes.userId, userId))
    .groupBy(watchedEpisodes.showTmdbId, shows.title)
    .orderBy(desc(sql`count(*)`))
    .limit(SEED_POOL);

  const movieSeeds = await db
    .select({
      tmdbId: userMovies.tmdbId,
      title: movies.title,
    })
    .from(userMovies)
    .innerJoin(movies, eq(movies.tmdbId, userMovies.tmdbId))
    .where(and(eq(userMovies.userId, userId), eq(userMovies.status, "watched")))
    .orderBy(desc(userMovies.watchedAt))
    .limit(SEED_POOL);

  const showPicks = pickRotated(
    showSeeds,
    3,
    rotationOffset(userId + ":foryou-tv", showSeeds.length)
  );
  const moviePicks = pickRotated(
    movieSeeds,
    2,
    rotationOffset(userId + ":foryou-mv", movieSeeds.length)
  );

  const buckets: TmdbMediaCard[][] = [];
  const seen = new Set<string>();

  for (const seed of showPicks) {
    try {
      const recs = await getTvRecommendations(seed.tmdbId);
      const items = recs.filter((r) => {
        if (ownedShowIds.has(r.id)) return false;
        const k = `tv:${r.id}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (items.length) buckets.push(items);
    } catch {
      /* skip */
    }
  }

  for (const seed of moviePicks) {
    try {
      const recs = await getMovieRecommendations(seed.tmdbId);
      const items = recs.filter((r) => {
        if (ownedMovieIds.has(r.id)) return false;
        const k = `movie:${r.id}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (items.length) buckets.push(items);
    } catch {
      /* skip */
    }
  }

  // Round-robin interleave so one seed doesn't dominate
  const out: TmdbMediaCard[] = [];
  let i = 0;
  while (out.length < limit) {
    let added = false;
    for (const bucket of buckets) {
      if (i < bucket.length) {
        out.push(bucket[i]);
        added = true;
        if (out.length >= limit) break;
      }
    }
    if (!added) break;
    i++;
  }
  return out;
}

export function filterNewMedia(
  items: TmdbMediaCard[],
  ownedIds: Set<number>,
  limit = 12
): TmdbMediaCard[] {
  const out: TmdbMediaCard[] = [];
  const seen = new Set<number>();
  for (const item of items) {
    if (ownedIds.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}
