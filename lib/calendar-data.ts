/**
 * Shared loader for episode calendars: every followed show (watching /
 * for_later) with its full episode catalog and the user's watched set.
 * Mirrors the Shows tab's data flow (bulk queries + targeted TMDB fills).
 */

import { db, withDbRetry, mapPool } from "./db";
import { shows, userShows, watchedEpisodes, episodes } from "./schema";
import { eq, and, inArray } from "drizzle-orm";
import {
  makeWatchedKey,
  type EpisodeInfo,
  type WatchedKey,
} from "./show-progress";
import { ensureEpisodes } from "./ensure";

export type CalendarShow = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  numberOfSeasons: number | null;
};

export type FollowedEpisodeData = {
  following: CalendarShow[];
  episodesByShow: Map<number, EpisodeInfo[]>;
  watchedByShow: Map<number, Set<WatchedKey>>;
};

export async function loadFollowedEpisodeData(
  userId: string
): Promise<FollowedEpisodeData> {
  const rows = await withDbRetry(() =>
    db
      .select({
        tmdbId: shows.tmdbId,
        title: shows.title,
        posterPath: shows.posterPath,
        numberOfSeasons: shows.numberOfSeasons,
        status: userShows.status,
      })
      .from(userShows)
      .innerJoin(shows, eq(userShows.tmdbId, shows.tmdbId))
      .where(eq(userShows.userId, userId))
  );

  const following = rows
    .filter((s) => s.status === "watching" || s.status === "for_later")
    .map((s) => ({
      tmdbId: s.tmdbId,
      title: s.title,
      posterPath: s.posterPath,
      numberOfSeasons: s.numberOfSeasons,
    }));

  const episodesByShow = new Map<number, EpisodeInfo[]>();
  const watchedByShow = new Map<number, Set<WatchedKey>>();
  if (following.length === 0) {
    return { following, episodesByShow, watchedByShow };
  }

  const ids = following.map((s) => s.tmdbId);
  const [episodeRows, watched] = await Promise.all([
    withDbRetry(() =>
      db
        .select({
          showTmdbId: episodes.showTmdbId,
          seasonNumber: episodes.seasonNumber,
          episodeNumber: episodes.episodeNumber,
          title: episodes.title,
          airDate: episodes.airDate,
          stillPath: episodes.stillPath,
        })
        .from(episodes)
        .where(inArray(episodes.showTmdbId, ids))
    ),
    withDbRetry(() =>
      db
        .select({
          showTmdbId: watchedEpisodes.showTmdbId,
          seasonNumber: watchedEpisodes.seasonNumber,
          episodeNumber: watchedEpisodes.episodeNumber,
        })
        .from(watchedEpisodes)
        .where(
          and(
            eq(watchedEpisodes.userId, userId),
            inArray(watchedEpisodes.showTmdbId, ids)
          )
        )
    ),
  ]);

  // Fill catalogs for shows with no cached episodes yet (cap blocking work)
  const withEpisodes = new Set(episodeRows.map((e) => e.showTmdbId));
  const missing = following.filter((s) => !withEpisodes.has(s.tmdbId));
  let allEpisodes = episodeRows as EpisodeInfo[];
  if (missing.length > 0) {
    const filled = await mapPool(missing.slice(0, 12), 3, (show) =>
      ensureEpisodes(show.tmdbId, show.numberOfSeasons).catch(() => [])
    );
    allEpisodes = allEpisodes.concat(filled.flat());
    const rest = missing.slice(12);
    if (rest.length > 0) {
      void mapPool(rest, 2, (show) =>
        ensureEpisodes(show.tmdbId, show.numberOfSeasons).catch(() => [])
      );
    }
  }

  for (const ep of allEpisodes) {
    let arr = episodesByShow.get(ep.showTmdbId);
    if (!arr) {
      arr = [];
      episodesByShow.set(ep.showTmdbId, arr);
    }
    arr.push(ep);
  }

  for (const w of watched) {
    let set = watchedByShow.get(w.showTmdbId);
    if (!set) {
      set = new Set();
      watchedByShow.set(w.showTmdbId, set);
    }
    set.add(makeWatchedKey(w.seasonNumber, w.episodeNumber));
  }

  return { following, episodesByShow, watchedByShow };
}
