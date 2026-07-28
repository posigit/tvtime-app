import { db, withDbRetry } from "./db";
import { shows, movies, episodes } from "./schema";
import {
  getTvDetails,
  getMovieDetails,
  getTvSeason,
  getTvExternalIds,
  getMovieExternalIds,
} from "./tmdb";
import { getRottenTomatoesScore } from "./omdb";
import { eq, sql } from "drizzle-orm";

/** Stored in `rt_score` when OMDb was checked and has no Tomatometer (stops retries). */
const RT_NONE = -1;

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
  rtScore?: number | null;
  imdbId?: string | null;
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
  rtScore?: number | null;
  imdbId?: string | null;
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

/**
 * Upsert show metadata. Returning series change over time (new seasons,
 * status flips to Ended), so a cached row must not stay frozen forever.
 */
function persistShow(show: ShowRow) {
  return db
    .insert(shows)
    .values(show)
    .onConflictDoUpdate({
      target: shows.tmdbId,
      set: {
        title: show.title,
        posterPath: show.posterPath,
        backdropPath: show.backdropPath,
        firstAirDate: show.firstAirDate,
        lastAirDate: show.lastAirDate,
        status: show.status,
        overview: show.overview,
        networks: show.networks,
        numberOfSeasons: show.numberOfSeasons,
        numberOfEpisodes: show.numberOfEpisodes,
        episodeRuntime: show.episodeRuntime,
        voteAverage: show.voteAverage,
        tmdbData: show.tmdbData,
        updatedAt: new Date(),
      },
    });
}

function persistMovie(movie: MovieRow) {
  return db.insert(movies).values(movie).onConflictDoNothing();
}

// ---------- Rotten Tomatoes background fill ----------

const rtInFlight = new Set<string>();

/**
 * Fetch + cache the RT Tomatometer for a title (via TMDB external_ids → OMDb).
 *
 * Persistence rules:
 * - Real score (0–100) when OMDb includes Rotten Tomatoes
 * - `rt_score = -1` when OMDb answered successfully but has no RT entry
 *   (stops retries so we don't burn the free-tier quota)
 * - Leave `rt_score` null on failure / rate limit so the next visit retries
 */
async function fillRtScore(
  tmdbId: number,
  type: "tv" | "movie",
  existingImdbId?: string | null
) {
  try {
    let imdbId = existingImdbId ?? null;
    if (!imdbId) {
      const ids =
        type === "tv"
          ? await getTvExternalIds(tmdbId)
          : await getMovieExternalIds(tmdbId);
      imdbId = ids.imdb_id ?? null;
    }

    const table = type === "tv" ? shows : movies;

    // No IMDb id → cannot query OMDb; mark checked so we stop retrying.
    if (!imdbId) {
      await withDbRetry(() =>
        db
          .update(table)
          .set({ imdbId: null, rtScore: RT_NONE })
          .where(eq(table.tmdbId, tmdbId))
      );
      return;
    }

    const { score, checked } = await getRottenTomatoesScore(imdbId);

    if (!checked) {
      // Keep imdb for next try; leave rt_score null so ensureRtScore retries.
      await withDbRetry(() =>
        db.update(table).set({ imdbId }).where(eq(table.tmdbId, tmdbId))
      );
      return;
    }

    await withDbRetry(() =>
      db
        .update(table)
        .set({ imdbId, rtScore: score ?? RT_NONE })
        .where(eq(table.tmdbId, tmdbId))
    );
  } catch (err) {
    console.error(
      `fillRtScore failed for ${type} ${tmdbId}:`,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Kick off a background RT fill when we do not yet have a resolved score.
 * `rt_score = -1` means "checked, no RT" and is treated as resolved.
 */
function ensureRtScore(
  row: { tmdbId: number; rtScore?: number | null; imdbId?: string | null },
  type: "tv" | "movie"
) {
  // null = never resolved (or failed last time) → try again
  // number (incl. -1) = done
  if (row.rtScore != null) return;
  const key = `${type}:${row.tmdbId}`;
  if (rtInFlight.has(key)) return;
  rtInFlight.add(key);
  void fillRtScore(row.tmdbId, type, row.imdbId).finally(() =>
    rtInFlight.delete(key)
  );
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
    if (existing) {
      ensureRtScore(existing, "tv");
      return existing;
    }
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
    .then(() => ensureRtScore({ ...show, tmdbId }, "tv"))
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
    if (existing) {
      ensureRtScore(existing, "movie");
      return existing;
    }
  } catch (err) {
    console.error(
      `ensureMovie: DB lookup failed for ${tmdbId}, falling back to TMDB:`,
      err instanceof Error ? err.message : err
    );
  }

  const details = await getMovieDetails(tmdbId);
  const movie = movieFromTmdb(tmdbId, details);

  void withDbRetry(() => persistMovie(movie))
    .then(() => ensureRtScore({ ...movie, tmdbId }, "movie"))
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
    .onConflictDoUpdate({
      target: [
        episodes.showTmdbId,
        episodes.seasonNumber,
        episodes.episodeNumber,
      ],
      set: {
        title: sql`excluded.title`,
        overview: sql`excluded.overview`,
        airDate: sql`excluded.air_date`,
        stillPath: sql`excluded.still_path`,
        runtime: sql`excluded.runtime`,
        updatedAt: new Date(),
      },
    })
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

const EPISODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const catalogRefreshInFlight = new Set<number>();

/**
 * Refetch show details + the seasons that can still change, upserting rows.
 * The latest cached season can still roll out weekly; anything above the old
 * season count is brand new. Older seasons are considered immutable.
 */
async function refreshShowCatalog(tmdbId: number) {
  const details = await getTvDetails(tmdbId);
  const show = showFromTmdb(tmdbId, details);
  await withDbRetry(() => persistShow(show));

  const numberOfSeasons = show.numberOfSeasons ?? 0;
  if (numberOfSeasons <= 0) return;

  const seasonRows = await withDbRetry(() =>
    db
      .select({ seasonNumber: episodes.seasonNumber })
      .from(episodes)
      .where(eq(episodes.showTmdbId, tmdbId))
  );
  const maxCached = seasonRows.reduce(
    (m, r) => Math.max(m, r.seasonNumber),
    0
  );
  const fromSeason = Math.max(1, maxCached);

  const fetchedEpisodes: EpisodeInfo[] = [];
  for (
    let seasonNumber = fromSeason;
    seasonNumber <= numberOfSeasons;
    seasonNumber++
  ) {
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
        console.error(
          `Refresh: failed season ${seasonNumber} for ${tmdbId}:`,
          message
        );
      }
    }
  }

  if (fetchedEpisodes.length > 0) {
    saveEpisodesWithRetry(tmdbId, fetchedEpisodes);
  }
}

/**
 * Kick a background catalog refresh when the cached episodes go stale (>24h).
 * Only "alive" shows refresh — ended/canceled catalogs are static, so a show
 * you were caught up on re-enters the Watch List when a new episode airs.
 */
function maybeRefreshShowCatalog(
  tmdbId: number,
  cached: { updatedAt: Date }[]
) {
  if (catalogRefreshInFlight.has(tmdbId)) return;

  const newest = cached.reduce(
    (m, r) => Math.max(m, r.updatedAt?.getTime?.() ?? 0),
    0
  );
  if (Date.now() - newest < EPISODE_CACHE_TTL_MS) return;

  catalogRefreshInFlight.add(tmdbId);
  void (async () => {
    try {
      const show = await withDbRetry(() =>
        db.query.shows.findFirst({ where: eq(shows.tmdbId, tmdbId) })
      );
      const alive =
        !show?.status ||
        show.status === "Returning Series" ||
        show.status === "In Production" ||
        show.status === "Planned";
      if (!alive) return;
      await refreshShowCatalog(tmdbId);
    } catch (err) {
      console.error(
        `Catalog refresh failed for ${tmdbId}:`,
        err instanceof Error ? err.message : err
      );
    } finally {
      catalogRefreshInFlight.delete(tmdbId);
    }
  })();
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
          updatedAt: episodes.updatedAt,
        })
        .from(episodes)
        .where(eq(episodes.showTmdbId, tmdbId))
    );

    if (existing.length > 0) {
      // Render-first: serve the cache now, refresh stale catalogs in background
      maybeRefreshShowCatalog(tmdbId, existing);
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
