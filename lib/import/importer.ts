import { db } from "@/lib/db";
import {
  episodeReactions,
  movieReactions,
  movies,
  shows,
  userLists,
  userMovies,
  userShows,
  watchedEpisodes,
} from "@/lib/schema";
import { getMovieDetails, getTvDetails } from "@/lib/tmdb";
import { and, eq, inArray } from "drizzle-orm";
import { ParsedGdprData } from "./parser";
import { TmdbMappingResult } from "./tmdb-mapper";

export async function importShows(
  userId: string,
  showMappings: TmdbMappingResult[],
  data: ParsedGdprData
) {
  const mappingByTvTimeId = new Map(showMappings.map((m) => [m.tvTimeId, m]));

  let i = 0;
  for (const [tvTimeId, showRecord] of data.shows) {
    const mapping = mappingByTvTimeId.get(tvTimeId);
    if (!mapping?.selectedTmdbId) {
      console.log(`Skipping unmapped show: ${showRecord.name}`);
      continue;
    }

    i++;
    const tmdbId = mapping.selectedTmdbId;

    // Fetch and cache show metadata
    const details = await getTvDetails(tmdbId);
    await db
      .insert(shows)
      .values({
        tmdbId,
        title: details.name,
        posterPath: details.poster_path,
        backdropPath: details.backdrop_path,
        firstAirDate: details.first_air_date,
        lastAirDate: details.last_air_date,
        status: details.status,
        overview: details.overview,
        networks: details.networks?.map((n) => n.name),
        numberOfSeasons: details.number_of_seasons,
        numberOfEpisodes: details.number_of_episodes,
        episodeRuntime: details.episode_run_time?.[0],
        voteAverage: details.vote_average,
        tmdbData: details,
      })
      .onConflictDoUpdate({
        target: shows.tmdbId,
        set: {
          title: details.name,
          posterPath: details.poster_path,
          backdropPath: details.backdrop_path,
          firstAirDate: details.first_air_date,
          lastAirDate: details.last_air_date,
          status: details.status,
          overview: details.overview,
          networks: details.networks?.map((n) => n.name),
          numberOfSeasons: details.number_of_seasons,
          numberOfEpisodes: details.number_of_episodes,
          episodeRuntime: details.episode_run_time?.[0],
          voteAverage: details.vote_average,
          tmdbData: details,
          updatedAt: new Date(),
        },
      });

    // Insert user show record
    console.log(`  [${i + 1}/${data.shows.size}] ${showRecord.name} -> TMDB ${tmdbId}`);
    await db
      .insert(userShows)
      .values({
        userId,
        tmdbId,
        status: showRecord.status,
        favorite: showRecord.isFavorited,
        archived: showRecord.isArchived,
        episodesWatched: showRecord.episodesWatched,
        lastSeason: showRecord.lastSeason,
        lastEpisode: showRecord.lastEpisode,
        lastWatchedAt: showRecord.lastWatchedAt,
        followedAt: showRecord.followedAt,
      })
      .onConflictDoUpdate({
        target: [userShows.userId, userShows.tmdbId],
        set: {
          status: showRecord.status,
          favorite: showRecord.isFavorited,
          archived: showRecord.isArchived,
          episodesWatched: showRecord.episodesWatched,
          lastSeason: showRecord.lastSeason,
          lastEpisode: showRecord.lastEpisode,
          lastWatchedAt: showRecord.lastWatchedAt,
          followedAt: showRecord.followedAt,
        },
      });
  }

  // Import watched episodes
  const watchedRecords = data.episodeWatches.filter(
    (w) => mappingByTvTimeId.get(w.tvShowId)?.selectedTmdbId
  );

  for (const watch of watchedRecords) {
    const mapping = mappingByTvTimeId.get(watch.tvShowId);
    if (!mapping?.selectedTmdbId) continue;

    await db
      .insert(watchedEpisodes)
      .values({
        userId,
        showTmdbId: mapping.selectedTmdbId,
        seasonNumber: watch.seasonNumber,
        episodeNumber: watch.episodeNumber,
        watchedAt: watch.watchedAt,
      })
      .onConflictDoUpdate({
        target: [watchedEpisodes.userId, watchedEpisodes.showTmdbId, watchedEpisodes.seasonNumber, watchedEpisodes.episodeNumber],
        set: {
          watchedAt: watch.watchedAt,
        },
      });
  }

  // Import episode reactions
  for (const reaction of data.episodeReactions) {
    const showRecord = Array.from(data.shows.values()).find((s) => s.name === reaction.tvShowName);
    const mapping = mappingByTvTimeId.get(showRecord?.tvShowId || 0);
    if (!mapping?.selectedTmdbId) continue;

    await db
      .insert(episodeReactions)
      .values({
        userId,
        showTmdbId: mapping.selectedTmdbId,
        seasonNumber: reaction.seasonNumber,
        episodeNumber: reaction.episodeNumber,
        reactionKey: reaction.reactionKey,
      })
      .onConflictDoNothing();
  }
}

export async function importMovies(
  userId: string,
  movieMappings: TmdbMappingResult[],
  data: ParsedGdprData
) {
  const mappingByName = new Map(movieMappings.map((m) => [m.query, m]));

  let i = 0;
  for (const movie of data.movies) {
    const mapping = mappingByName.get(movie.name);
    if (!mapping?.selectedTmdbId) {
      console.log(`Skipping unmapped movie: ${movie.name}`);
      continue;
    }

    i++;
    const tmdbId = mapping.selectedTmdbId;
    console.log(`  [${i}/${data.movies.length}] ${movie.name} -> TMDB ${tmdbId}`);

    // Fetch and cache movie metadata
    const details = await getMovieDetails(tmdbId);
    await db
      .insert(movies)
      .values({
        tmdbId,
        title: details.title,
        posterPath: details.poster_path,
        backdropPath: details.backdrop_path,
        releaseDate: details.release_date,
        runtime: details.runtime,
        status: details.status,
        overview: details.overview,
        voteAverage: details.vote_average,
        tmdbData: details,
      })
      .onConflictDoUpdate({
        target: movies.tmdbId,
        set: {
          title: details.title,
          posterPath: details.poster_path,
          backdropPath: details.backdrop_path,
          releaseDate: details.release_date,
          runtime: details.runtime,
          status: details.status,
          overview: details.overview,
          voteAverage: details.vote_average,
          tmdbData: details,
          updatedAt: new Date(),
        },
      });

    // Insert user movie record
    await db
      .insert(userMovies)
      .values({
        userId,
        tmdbId,
        status: movie.status,
        watchedAt: movie.watchedAt,
      })
      .onConflictDoUpdate({
        target: [userMovies.userId, userMovies.tmdbId],
        set: {
          status: movie.status,
          watchedAt: movie.watchedAt,
        },
      });
  }

  // Import movie reactions
  const movieUuidToTmdbId = new Map(
    data.movies
      .map((m) => {
        const mapping = mappingByName.get(m.name);
        return mapping?.selectedTmdbId ? [m.uuid, mapping.selectedTmdbId] : null;
      })
      .filter(Boolean) as [string, number][]
  );

  for (const reaction of data.movieReactions) {
    const tmdbId = movieUuidToTmdbId.get(reaction.movieUuid);
    if (!tmdbId) continue;

    await db
      .insert(movieReactions)
      .values({
        userId,
        tmdbId,
        reactionKey: reaction.reactionKey,
      })
      .onConflictDoNothing();
  }
}

export async function importLists(
  userId: string,
  showMappings: TmdbMappingResult[],
  movieMappings: TmdbMappingResult[],
  data: ParsedGdprData
) {
  const showMappingByTvTimeId = new Map(showMappings.map((m) => [m.tvTimeId, m]));
  const movieMappingByName = new Map(movieMappings.map((m) => [m.query, m]));

  for (const list of data.lists) {
    const mappedItems = list.items
      .map((item) => {
        if (item.type === "tv") {
          const mapping = showMappingByTvTimeId.get(item.tvTimeId as number);
          if (mapping?.selectedTmdbId) {
            return { type: "tv", tmdbId: mapping.selectedTmdbId, addedAt: item.addedAt };
          }
        } else {
          // Find movie by TV Time UUID - we need to match by name
          const movieRecord = data.movies.find((m) => m.uuid === item.tvTimeId);
          const mapping = movieRecord ? movieMappingByName.get(movieRecord.name) : undefined;
          if (mapping?.selectedTmdbId) {
            return { type: "movie", tmdbId: mapping.selectedTmdbId, addedAt: item.addedAt };
          }
        }
        return null;
      })
      .filter(Boolean);

    await db
      .insert(userLists)
      .values({
        id: list.id,
        userId,
        name: list.name,
        type: list.type,
        items: mappedItems,
      })
      .onConflictDoUpdate({
        target: userLists.id,
        set: {
          name: list.name,
          type: list.type,
          items: mappedItems,
        },
      });

    // Mirror favorite lists onto the library rows' favorite flag so the
    // Favorite rails / pages populate (the flag is the app's source of truth).
    if (list.type === "favorite_shows" || list.type === "favorite_movies") {
      const tmdbIds = mappedItems
        .map((item) => item?.tmdbId)
        .filter((id): id is number => Number.isFinite(id));
      if (tmdbIds.length > 0) {
        const table =
          list.type === "favorite_shows" ? userShows : userMovies;
        await db
          .update(table)
          .set({ favorite: true })
          .where(
            and(eq(table.userId, userId), inArray(table.tmdbId, tmdbIds))
          );
      }
    }
  }
}
