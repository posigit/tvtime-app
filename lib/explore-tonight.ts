import { db, withDbRetry } from "./db";
import { episodes, shows, userShows, watchedEpisodes } from "./schema";
import { and, eq, gt, isNotNull } from "drizzle-orm";
import { appTodayYmd } from "./app-time";

export type TonightItem = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string;
};

/**
 * Followed shows with an episode airing today that is not yet watched.
 * Cheap: only rows already in the episode catalog — no TMDB.
 */
export async function getTonightEpisodes(
  userId: string,
  limit = 10
): Promise<TonightItem[]> {
  const today = appTodayYmd();
  try {
    const rows = await withDbRetry(() =>
      db
        .select({
          tmdbId: shows.tmdbId,
          title: shows.title,
          posterPath: shows.posterPath,
          seasonNumber: episodes.seasonNumber,
          episodeNumber: episodes.episodeNumber,
          episodeTitle: episodes.title,
          watchedUser: watchedEpisodes.userId,
        })
        .from(userShows)
        .innerJoin(shows, eq(shows.tmdbId, userShows.tmdbId))
        .innerJoin(episodes, eq(episodes.showTmdbId, shows.tmdbId))
        .leftJoin(
          watchedEpisodes,
          and(
            eq(watchedEpisodes.userId, userId),
            eq(watchedEpisodes.showTmdbId, shows.tmdbId),
            eq(watchedEpisodes.seasonNumber, episodes.seasonNumber),
            eq(watchedEpisodes.episodeNumber, episodes.episodeNumber)
          )
        )
        .where(
          and(
            eq(userShows.userId, userId),
            eq(episodes.airDate, today),
            gt(episodes.seasonNumber, 0),
            isNotNull(episodes.airDate)
          )
        )
        .limit(limit * 2)
    );

    const out: TonightItem[] = [];
    const seen = new Set<number>();
    for (const row of rows) {
      if (row.watchedUser) continue;
      if (seen.has(row.tmdbId)) continue;
      seen.add(row.tmdbId);
      out.push({
        tmdbId: row.tmdbId,
        title: row.title,
        posterPath: row.posterPath,
        seasonNumber: row.seasonNumber,
        episodeNumber: row.episodeNumber,
        episodeTitle: row.episodeTitle,
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch (err) {
    console.error(
      "tonight episodes failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
