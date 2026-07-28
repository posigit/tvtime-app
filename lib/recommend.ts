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
 * "Because you watched…" rails from highest-rated / recent titles,
 * via TMDB recommendations, excluding library.
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
    .limit(4);

  let movieSeeds = await db
    .select({
      tmdbId: userMovies.tmdbId,
      title: movies.title,
      rating: userMovies.rating,
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
    .limit(4);

  if (movieSeeds.length === 0) {
    movieSeeds = await db
      .select({
        tmdbId: userMovies.tmdbId,
        title: movies.title,
        rating: userMovies.rating,
      })
      .from(userMovies)
      .innerJoin(movies, eq(movies.tmdbId, userMovies.tmdbId))
      .where(
        and(eq(userMovies.userId, userId), eq(userMovies.status, "watched"))
      )
      .orderBy(desc(userMovies.watchedAt))
      .limit(3);
  }

  // Fallback show seeds: most watched episodes if no ratings
  let showSeeds = topShows;
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
      .limit(3);
  }

  const rails: { seedTitle: string; items: TmdbMediaCard[] }[] = [];
  const seen = new Set<string>();

  for (const seed of showSeeds.slice(0, 2)) {
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

  for (const seed of movieSeeds.slice(0, 2)) {
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
