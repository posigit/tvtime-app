/**
 * DB-backed TMDB list cache with stale-while-revalidate.
 * First visitor after TTL still gets the last payload immediately.
 */

import { db, withDbRetry } from "./db";
import { tmdbListCache } from "./schema";
import { eq } from "drizzle-orm";
import {
  discoverMoviesByGenre,
  discoverTvByGenre,
  getAiringTodayCards,
  getNowPlayingMovies,
  getOnTheAirCards,
  getPopularMovies,
  getPopularTv,
  getTopRatedMovies,
  getTopRatedTv,
  getTrendingMovieCards,
  getTrendingTvCards,
  getUpcomingMovies,
  type TmdbMediaCard,
} from "./tmdb";

export const TRENDING_TTL_MS = 60 * 60 * 1000;
export const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

export const LIST_KEY = {
  trendingTvDay: "trending_tv_day",
  trendingTvWeek: "trending_tv_week",
  trendingMovieDay: "trending_movie_day",
  trendingMovieWeek: "trending_movie_week",
  popularMovies: "popular_movies",
  popularTv: "popular_tv",
  topRatedTv: "top_rated_tv",
  topRatedMovies: "top_rated_movies",
  nowPlaying: "now_playing_movies",
  upcoming: "upcoming_movies",
  airingToday: "airing_today",
  onTheAir: "on_the_air",
} as const;

function genreKey(kind: "tv" | "movie", id: number) {
  return `genre:${kind}:${id}`;
}

const inflight = new Map<string, Promise<TmdbMediaCard[]>>();
const refreshing = new Set<string>();

function isCardArray(value: unknown): value is TmdbMediaCard[] {
  return Array.isArray(value);
}

async function readRow(key: string) {
  try {
    const rows = await withDbRetry(() =>
      db
        .select()
        .from(tmdbListCache)
        .where(eq(tmdbListCache.key, key))
        .limit(1)
    );
    return rows[0] ?? null;
  } catch (err) {
    console.error(
      "tmdb_list_cache read failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

async function writeRow(key: string, payload: TmdbMediaCard[]) {
  try {
    await withDbRetry(() =>
      db
        .insert(tmdbListCache)
        .values({
          key,
          payload,
          fetchedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: tmdbListCache.key,
          set: { payload, fetchedAt: new Date() },
        })
    );
  } catch (err) {
    console.error(
      "tmdb_list_cache write failed:",
      err instanceof Error ? err.message : err
    );
  }
}

function ageMs(fetchedAt: Date | string | null | undefined) {
  if (!fetchedAt) return Number.POSITIVE_INFINITY;
  const t = fetchedAt instanceof Date ? fetchedAt.getTime() : Date.parse(String(fetchedAt));
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Date.now() - t;
}

export async function getCachedList(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<TmdbMediaCard[]>
): Promise<TmdbMediaCard[]> {
  const row = await readRow(key);
  const cached = row && isCardArray(row.payload) ? row.payload : null;
  const stale = !row || ageMs(row.fetchedAt) > ttlMs;

  if (cached && !stale) return cached;

  if (cached && stale) {
    if (!refreshing.has(key)) {
      refreshing.add(key);
      void (async () => {
        try {
          const fresh = await fetcher();
          if (fresh.length > 0 || !cached.length) {
            await writeRow(key, fresh);
          }
        } catch (err) {
          console.error(
            `tmdb list refresh ${key}:`,
            err instanceof Error ? err.message : err
          );
        } finally {
          refreshing.delete(key);
        }
      })();
    }
    return cached;
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const pending = (async () => {
    const fresh = await fetcher();
    await writeRow(key, fresh);
    return fresh;
  })();

  inflight.set(key, pending);
  try {
    return await pending;
  } finally {
    inflight.delete(key);
  }
}

function popularMovieCards() {
  return getPopularMovies().then((data) =>
    (data.results ?? []).map((m) => ({
      id: m.id,
      title: m.title,
      poster_path: m.poster_path,
      backdrop_path: m.backdrop_path,
      mediaType: "movie" as const,
    }))
  );
}

export function cachedTrendingTv(window: "day" | "week") {
  const key =
    window === "day" ? LIST_KEY.trendingTvDay : LIST_KEY.trendingTvWeek;
  return getCachedList(key, TRENDING_TTL_MS, () => getTrendingTvCards(window));
}

export function cachedTrendingMovies(window: "day" | "week") {
  const key =
    window === "day" ? LIST_KEY.trendingMovieDay : LIST_KEY.trendingMovieWeek;
  return getCachedList(key, TRENDING_TTL_MS, () =>
    getTrendingMovieCards(window)
  );
}

export function cachedPopularMovies() {
  return getCachedList(LIST_KEY.popularMovies, CATALOG_TTL_MS, popularMovieCards);
}

export function cachedPopularTv() {
  return getCachedList(LIST_KEY.popularTv, CATALOG_TTL_MS, getPopularTv);
}

export function cachedTopRatedTv() {
  return getCachedList(LIST_KEY.topRatedTv, CATALOG_TTL_MS, getTopRatedTv);
}

export function cachedTopRatedMovies() {
  return getCachedList(LIST_KEY.topRatedMovies, CATALOG_TTL_MS, getTopRatedMovies);
}

export function cachedNowPlaying() {
  return getCachedList(LIST_KEY.nowPlaying, CATALOG_TTL_MS, getNowPlayingMovies);
}

export function cachedUpcoming() {
  return getCachedList(LIST_KEY.upcoming, CATALOG_TTL_MS, getUpcomingMovies);
}

export function cachedAiringToday() {
  return getCachedList(LIST_KEY.airingToday, TRENDING_TTL_MS, getAiringTodayCards);
}

export function cachedOnTheAir() {
  return getCachedList(LIST_KEY.onTheAir, TRENDING_TTL_MS, getOnTheAirCards);
}

export function cachedGenreList(kind: "tv" | "movie", genreId: number) {
  return getCachedList(genreKey(kind, genreId), CATALOG_TTL_MS, () =>
    kind === "tv"
      ? discoverTvByGenre(genreId)
      : discoverMoviesByGenre(genreId)
  );
}

export function rankTopTen(
  items: TmdbMediaCard[],
  limit = 10
): TmdbMediaCard[] {
  const out: TmdbMediaCard[] = [];
  const seen = new Set<number>();
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** Best-effort warm of the hot Explore keys (cron). */
export async function warmTmdbListCache(): Promise<{ warmed: number; failed: number }> {
  const jobs: Array<() => Promise<unknown>> = [
    () => cachedTrendingTv("day"),
    () => cachedTrendingTv("week"),
    () => cachedTrendingMovies("day"),
    () => cachedTrendingMovies("week"),
    () => cachedPopularMovies(),
    () => cachedPopularTv(),
    () => cachedTopRatedTv(),
    () => cachedTopRatedMovies(),
    () => cachedNowPlaying(),
    () => cachedUpcoming(),
    () => cachedAiringToday(),
    () => cachedOnTheAir(),
  ];
  let warmed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await job();
      warmed++;
    } catch {
      failed++;
    }
  }
  return { warmed, failed };
}
