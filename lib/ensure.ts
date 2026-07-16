import { db } from "./db";
import { shows, movies, episodes } from "./schema";
import { getTvDetails, getMovieDetails, getTvSeason } from "./tmdb";
import { eq } from "drizzle-orm";

export async function ensureShow(tmdbId: number) {
  const existing = await db.query.shows.findFirst({
    where: eq(shows.tmdbId, tmdbId),
  });
  if (existing) return existing;

  const details = await getTvDetails(tmdbId);

  const show = {
    tmdbId,
    title: details.name,
    posterPath: details.poster_path ?? null,
    backdropPath: details.backdrop_path ?? null,
    firstAirDate: details.first_air_date ?? null,
    lastAirDate: details.last_air_date ?? null,
    status: details.status ?? null,
    overview: details.overview ?? null,
    networks: details.networks?.map((n) => n.name) ?? null,
    numberOfSeasons: details.number_of_seasons ?? null,
    numberOfEpisodes: details.number_of_episodes ?? null,
    episodeRuntime: details.episode_run_time?.[0] ?? null,
    voteAverage: details.vote_average ?? null,
    tmdbData: details,
  };

  // Save to DB in the background — data is already in memory, don't block render
  db.insert(shows).values(show).onConflictDoNothing().catch(() => {});

  return show;
}

export async function ensureMovie(tmdbId: number) {
  const existing = await db.query.movies.findFirst({
    where: eq(movies.tmdbId, tmdbId),
  });
  if (existing) return existing;

  const details = await getMovieDetails(tmdbId);

  const movie = {
    tmdbId,
    title: details.title,
    posterPath: details.poster_path ?? null,
    backdropPath: details.backdrop_path ?? null,
    releaseDate: details.release_date ?? null,
    runtime: details.runtime ?? null,
    status: details.status ?? null,
    overview: details.overview ?? null,
    voteAverage: details.vote_average ?? null,
    tmdbData: details,
  };

  // Save to DB in the background — data is already in memory, don't block render
  db.insert(movies).values(movie).onConflictDoNothing().catch(() => {});

  return movie;
}

export type EpisodeInfo = {
  showTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview?: string | null;
  airDate?: string | null;
  stillPath?: string | null;
  runtime?: number | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function saveEpisodesWithRetry(
  tmdbId: number,
  fetchedEpisodes: EpisodeInfo[],
  attempts = 5,
  delay = 100
) {
  if (fetchedEpisodes.length === 0) return;

  db.insert(episodes)
    .values(fetchedEpisodes)
    .onConflictDoNothing()
    .then(() => {
      console.log(`Persisted ${fetchedEpisodes.length} episodes for show ${tmdbId}`);
    })
    .catch((err) => {
      if (attempts > 0) {
        setTimeout(
          () => saveEpisodesWithRetry(tmdbId, fetchedEpisodes, attempts - 1, delay * 1.5),
          delay
        );
      } else {
        console.error(`Failed to persist episodes for show ${tmdbId}:`, err);
      }
    });
}

export async function ensureEpisodes(
  tmdbId: number,
  numberOfSeasons: number | null
): Promise<EpisodeInfo[]> {
  const existing = await db
    .select({
      showTmdbId: episodes.showTmdbId,
      seasonNumber: episodes.seasonNumber,
      episodeNumber: episodes.episodeNumber,
      title: episodes.title,
      overview: episodes.overview,
      airDate: episodes.airDate,
      stillPath: episodes.stillPath,
      runtime: episodes.runtime,
    })
    .from(episodes)
    .where(eq(episodes.showTmdbId, tmdbId));

  if (existing.length > 0) {
    return existing;
  }

  if (!numberOfSeasons || numberOfSeasons <= 0) {
    return [];
  }

  const fetchedEpisodes: EpisodeInfo[] = [];

  for (let seasonNumber = 1; seasonNumber <= numberOfSeasons; seasonNumber++) {
    try {
      const season = await getTvSeason(tmdbId, seasonNumber);
      for (const ep of season.episodes) {
        fetchedEpisodes.push({
          showTmdbId: tmdbId,
          seasonNumber: ep.season_number,
          episodeNumber: ep.episode_number,
          title: ep.name || `Episode ${ep.episode_number}`,
          overview: ep.overview ?? null,
          airDate: ep.air_date ?? null,
          stillPath: ep.still_path ?? null,
          runtime: ep.runtime ?? null,
        });
      }
      await sleep(50);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("404")) {
        console.error(`Failed to fetch season ${seasonNumber} for ${tmdbId}:`, message);
      }
    }
  }

  // Persist in the background with retry so a slow parent-row insert doesn't block render
  saveEpisodesWithRetry(tmdbId, fetchedEpisodes);

  return fetchedEpisodes;
}
