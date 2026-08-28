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
 * How often personal "Because you watched" *posters* advance inside a rail.
 * Seeds themselves skip whatever was shown last visit (see excludeSeedIds).
 */
const ROTATION_MS = 15 * 60 * 1000;
/** Pull this many candidates for rotation. */
const SEED_POOL = 16;
/**
 * Max "Because you watched X" rails on Explore.
 * Keep this low — a mixed "For you" rail covers the rest.
 */
const BECAUSE_RAILS_MAX = 2;

type Seed = { tmdbId: number; title: string };

export type BecauseRail = {
  seedTitle: string;
  seedTmdbId: number;
  items: TmdbMediaCard[];
};

/** Merge seed lists, first-seen wins, cap at `limit`. */
export function mergeSeeds<T extends { tmdbId: number }>(
  primary: T[],
  extra: T[],
  limit: number
): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const s of [...primary, ...extra]) {
    if (!s || !Number.isFinite(s.tmdbId) || seen.has(s.tmdbId)) continue;
    seen.add(s.tmdbId);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Prefer titles that were not just shown. If that empties the pool
 * (tiny library), fall back to the full pool so we still have rails.
 */
export function pickSeedsSkippingRecent<T extends { tmdbId: number }>(
  pool: T[],
  count: number,
  recentIds: number[],
  offset: number
): T[] {
  if (pool.length === 0 || count <= 0) return [];
  const recent = new Set(recentIds);
  const fresh = pool.filter((s) => !recent.has(s.tmdbId));
  const source = fresh.length > 0 ? fresh : pool;
  return pickRotated(source, Math.min(count, source.length), offset);
}

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
  if (pool.length === 0 || count <= 0) return [];
  const n = Math.min(count, pool.length);
  const start = ((offset % pool.length) + pool.length) % pool.length;
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    out.push(pool[(start + i) % pool.length]);
  }
  return out;
}

/**
 * "Because you watched…" rails from highest-rated / recent titles,
 * via TMDB recommendations, excluding library.
 *
 * Seeds skip whatever was shown last visit, then rotate through a larger pool.
 * Posters inside a rail also rotate so the same rec is not always first.
 */
export async function getBecauseYouWatched(
  userId: string,
  limit = 18,
  opts?: { excludeSeedIds?: number[]; excludeSeedTitles?: string[] }
): Promise<BecauseRail[]> {
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

  const recentMovieSeeds = await db
    .select({
      tmdbId: userMovies.tmdbId,
      title: movies.title,
    })
    .from(userMovies)
    .innerJoin(movies, eq(movies.tmdbId, userMovies.tmdbId))
    .where(and(eq(userMovies.userId, userId), eq(userMovies.status, "watched")))
    .orderBy(desc(userMovies.watchedAt))
    .limit(SEED_POOL);
  movieSeeds = mergeSeeds(movieSeeds, recentMovieSeeds, SEED_POOL);

  const mostWatchedShows = await db
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
  const showSeeds = mergeSeeds(topShows, mostWatchedShows, SEED_POOL);

  const excludeTitles = new Set(
    (opts?.excludeSeedTitles ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean)
  );
  const exclude = [
    ...(opts?.excludeSeedIds ?? []),
    ...showSeeds
      .concat(movieSeeds)
      .filter((s) => excludeTitles.has(s.title.trim().toLowerCase()))
      .map((s) => s.tmdbId),
  ];

  // Prefer one TV seed + one movie seed (max 2 "Because you watched" rails)
  const showPick = pickSeedsSkippingRecent(
    showSeeds,
    1,
    exclude,
    rotationOffset(userId + ":tv", Math.max(showSeeds.length, 1))
  )[0];
  const moviePick = pickSeedsSkippingRecent(
    movieSeeds,
    1,
    exclude,
    rotationOffset(userId + ":m", Math.max(movieSeeds.length, 1))
  )[0];

  const rails: BecauseRail[] = [];
  const seen = new Set<string>();

  const pushRail = async (
    seed: Seed,
    kind: "tv" | "movie"
  ) => {
    if (rails.length >= BECAUSE_RAILS_MAX) return;
    try {
      const recs =
        kind === "tv"
          ? await getTvRecommendations(seed.tmdbId)
          : await getMovieRecommendations(seed.tmdbId);
      const owned = kind === "tv" ? ownedShowIds : ownedMovieIds;
      const filtered = recs.filter((r) => {
        if (owned.has(r.id)) return false;
        const k = `${kind}:${r.id}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const items = pickRotated(
        filtered,
        limit,
        rotationOffset(`${userId}:${kind}:${seed.tmdbId}`, filtered.length)
      );
      if (items.length > 0) {
        rails.push({
          seedTitle: seed.title,
          seedTmdbId: seed.tmdbId,
          items,
        });
      }
    } catch {
      /* skip */
    }
  };

  if (showPick) await pushRail(showPick, "tv");
  if (moviePick) await pushRail(moviePick, "movie");

  // Second TV seed if movies were thin
  if (rails.length < BECAUSE_RAILS_MAX && showSeeds.length > 1) {
    const used = new Set([
      ...exclude,
      ...rails.map((r) => r.seedTmdbId),
      showPick?.tmdbId,
      moviePick?.tmdbId,
    ].filter((id): id is number => typeof id === "number"));
    const alt = pickSeedsSkippingRecent(
      showSeeds,
      1,
      [...used],
      rotationOffset(userId + ":alt", Math.max(showSeeds.length, 1))
    )[0];
    if (alt) await pushRail(alt, "tv");
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
