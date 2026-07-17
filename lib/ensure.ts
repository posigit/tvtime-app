import { db, withDbRetry } from "./db";
import { shows, movies, episodes } from "./schema";
import { getTvDetails, getMovieDetails, getTvSeason } from "./tmdb";
import { eq } from "drizzle-orm";

type ShowRow = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  firstAirDate: string | null;
  lastAirDate: string | null;
  status: string | null;
  overview: string | null;
  networks: string[] | null;
  numberOfSeasons: number | null;
  numberOfEpisodes: number | null;
  episodeRuntime: number | null;
  voteAverage: number | null;
  tmdbData: unknown;
};

type MovieRow = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string | null;
  runtime: number | null;
  status: string | null;
  overview: string | null;
  voteAverage: number | null;
  tmdbData: unknown;
};

function showFromTmdb(tmdbId: number, details: Awaited<ReturnType<typeof getTvDetails>>): ShowRow {
  return {
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
}

function movieFromTmdb(
  tmdbId: number,
  details: Awaited<ReturnType<typeof getMovieDetails>>
): MovieRow {
  return {
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
}

function persistShow(show: ShowRow) {
  return db.insert(shows).values(show).onConflictDoNothing();
}

function persistMovie(movie: MovieRow) {
  return db.insert(movies).values(movie).onConflictDoNothing();
}

/**
 * Return show from DB cache or TMDB.
 * Transient DB failures are retried; if DB stays down, still returns TMDB data
 * so the page does not hard-crash (render-first).
 */
export async function ensureShow(tmdbId: number) {
  try {
    const existing = await withDbRetry(() =>
      db.query.shows.findFirst({
        where: eq(shows.tmdbId, tmdbId),
      })
    );
    if (existing) return existing;
  } catch (err) {
    console.error(
      `ensureShow: DB lookup failed for ${tmdbId}, falling back to TMDB:`,
      err instanceof Error ? err.message : err
    );
  }

  const details = await getTvDetails(tmdbId);
  const show = showFromTmdb(tmdbId, details);

  // Background save — do not block render
  void withDbRetry(() => persistShow(show))
    .then(() => undefined)
    .catch((err) => {
      console.error(`Failed to persist show ${tmdbId}:`, err);
    });

  return show;
}

export async function ensureMovie(tmdbId: number) {
  try {
    const existing = await withDbRetry(() =>
      db.query.movies.findFirst({
        where: eq(movies.tmdbId, tmdbId),
      })
    );
    if (existing) return existing;
  } catch (err) {
    console.error(
      `ensureMovie: DB lookup failed for ${tmdbId}, falling back to TMDB:`,
      err instanceof Error ? err.message : err
    );
  }

  const details = await getMovieDetails(tmdbId);
  const movie = movieFromTmdb(tmdbId, details);

  void withDbRetry(() => persistMovie(movie))
    .then(() => undefined)
    .catch((err) => {
      console.error(`Failed to persist movie ${tmdbId}:`, err);
    });

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

/**
 * Persist episodes in the background. On FK failure (parent show not ready),
 * re-fetch/insert the parent show once, then retry episodes with backoff.
 */
function saveEpisodesWithRetry(
  tmdbId: number,
  fetchedEpisodes: EpisodeInfo[],
  attempts = 5,
  delay = 100,
  triedParent = false
) {
  if (fetchedEpisodes.length === 0) return;

  db.insert(episodes)
    .values(fetchedEpisodes)
    .onConflictDoNothing()
    .then(() => {
      console.log(`Persisted ${fetchedEpisodes.length} episodes for show ${tmdbId}`);
    })
    .catch(async (err) => {
      if (!triedParent) {
        try {
          const details = await getTvDetails(tmdbId);
          await withDbRetry(() => persistShow(showFromTmdb(tmdbId, details)));
        } catch (parentErr) {
          console.error(`Failed to re-persist parent show ${tmdbId}:`, parentErr);
        }
        setTimeout(
          () =>
            saveEpisodesWithRetry(
              tmdbId,
              fetchedEpisodes,
              attempts - 1,
              delay * 1.5,
              true
            ),
          delay
        );
        return;
      }

      if (attempts > 0) {
        setTimeout(
          () =>
            saveEpisodesWithRetry(
              tmdbId,
              fetchedEpisodes,
              attempts - 1,
              delay * 1.5,
              true
            ),
          delay
        );
      } else {
        console.error(`Failed to persist episodes for show ${tmdbId}:`, err);
      }
    });
}

async function fetchEpisodesFromTmdb(
  tmdbId: number,
  numberOfSeasons: number
): Promise<EpisodeInfo[]> {
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

  return fetchedEpisodes;
}

export async function ensureEpisodes(
  tmdbId: number,
  numberOfSeasons: number | null
): Promise<EpisodeInfo[]> {
  try {
    const existing = await withDbRetry(() =>
      db
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
        .where(eq(episodes.showTmdbId, tmdbId))
    );

    if (existing.length > 0) {
      return existing;
    }
  } catch (err) {
    console.error(
      `ensureEpisodes: DB lookup failed for ${tmdbId}, falling back to TMDB:`,
      err instanceof Error ? err.message : err
    );
  }

  if (!numberOfSeasons || numberOfSeasons <= 0) {
    return [];
  }

  const fetchedEpisodes = await fetchEpisodesFromTmdb(tmdbId, numberOfSeasons);

  // Ensure parent exists first in background chain, then episodes with retry
  void (async () => {
    try {
      const existingShow = await withDbRetry(() =>
        db.query.shows.findFirst({
          where: eq(shows.tmdbId, tmdbId),
        })
      );
      if (!existingShow) {
        const details = await getTvDetails(tmdbId);
        await withDbRetry(() => persistShow(showFromTmdb(tmdbId, details)));
      }
    } catch (err) {
      console.error(`Background parent ensure failed for ${tmdbId}:`, err);
    }
    saveEpisodesWithRetry(tmdbId, fetchedEpisodes);
  })();

  return fetchedEpisodes;
}
