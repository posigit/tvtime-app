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

/** How often "Because you watched" seeds advance (ms). 4h → ~6 rotations/day. */
const ROTATION_MS = 4 * 60 * 60 * 1000;
/** Pull this many candidates; we only surface RAILS_PER_KIND of each. */
const SEED_POOL = 6;
const RAILS_PER_KIND = 2;

type Seed = { tmdbId: number; title: string };

/**
 * Stable-ish daily rotation: advances every ROTATION_MS, offset by userId so
 * different accounts don't all show the same seed at the same hour.
 */
function rotationOffset(userId: string, poolSize: number): number {
  if (poolSize <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  const slot = Math.floor(Date.now() / ROTATION_MS);
  return (slot + hash) % poolSize;
}

/** Pick `count` items from `pool`, starting at a rotating offset (wraps). */
function pickRotated<T>(pool: T[], count: number, offset: number): T[] {
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

  const showPicks = pickRotated(
    showSeeds,
    RAILS_PER_KIND,
    rotationOffset(userId, showSeeds.length)
  );
  const moviePicks = pickRotated(
    movieSeeds,
    RAILS_PER_KIND,
    // +1 so movie rails don't always share the same slot phase as shows
    rotationOffset(userId + ":m", movieSeeds.length)
  );

  const rails: { seedTitle: string; items: TmdbMediaCard[] }[] = [];
  const seen = new Set<string>();

  for (const seed of showPicks) {
    try {
      const recs = await getTvRecommendations(seed.tmdbId);
      const items = recs
        .filter((r) => !ownedShowIds.has(r.id))
        .filter((r) => {
          const k = `tv:${r.id}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, limit);
      if (items.length > 0) rails.push({ seedTitle: seed.title, items });
    } catch {
      /* skip */
    }
  }

  for (const seed of moviePicks) {
    try {
      const recs = await getMovieRecommendations(seed.tmdbId);
      const items = recs
        .filter((r) => !ownedMovieIds.has(r.id))
        .filter((r) => {
          const k = `movie:${r.id}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, limit);
      if (items.length > 0) rails.push({ seedTitle: seed.title, items });
    } catch {
      /* skip */
    }
  }

  return rails;
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
