import { db, withDbRetry } from "./db";
import { shows, movies, episodes } from "./schema";
import {
  getTvDetails,
  getMovieDetails,
  getTvSeason,
} from "./tmdb";
import { getTvmazeAirdateMap, isAppleTv } from "./tvmaze";
import { resolveRtScores } from "./rt-resolve";
import { eq, sql } from "drizzle-orm";

/** Stored in `rt_score` when OMDb/RT was checked and has no Tomatometer. */
const RT_NONE = -1;
/** Re-check Tomatometer this often even when a score already exists. */
const RT_STALE_MS = 14 * 24 * 60 * 60 * 1000;

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
  rtAudienceScore?: number | null;
  mcScore?: number | null;
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
  rtAudienceScore?: number | null;
  mcScore?: number | null;
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
 * Fetch + cache the RT Tomatometer (+ Popcornmeter + Metacritic) for a title.
 *
 * Sources (shared resolver in rt-resolve.ts):
 *   1) OMDb (Tomatometer + Metacritic)
 *   2) RT title page fallback (/m/ or /tv/) — Tomatometer + Popcornmeter
 *
 * Persistence rules:
 * - Real score (0–100) when found
 * - `-1` when sources answered with no score
 * - Leave unchanged on failure / rate limit (retry next visit)
 * - Always stamp `rt_checked_at` on a successful check so we re-poll every 2 weeks
 */
async function fillRtScore(
  tmdbId: number,
  type: "tv" | "movie",
  opts?: {
    imdbId?: string | null;
    title?: string | null;
    firstAirDate?: string | null;
    releaseDate?: string | null;
  }
) {
  try {
    let title = opts?.title ?? null;
    let date =
      type === "tv"
        ? (opts?.firstAirDate ?? null)
        : (opts?.releaseDate ?? null);

    const table = type === "tv" ? shows : movies;

    // The RT fallback needs a title; fetch from DB when the caller didn't have one
    if (!title) {
      if (type === "tv") {
        const row = await withDbRetry(() =>
          db.query.shows.findFirst({ where: eq(shows.tmdbId, tmdbId) })
        );
        title = row?.title ?? null;
        if (!date) date = row?.firstAirDate ?? null;
      } else {
        const row = await withDbRetry(() =>
          db.query.movies.findFirst({ where: eq(movies.tmdbId, tmdbId) })
        );
        title = row?.title ?? null;
        if (!date) date = row?.releaseDate ?? null;
      }
    }

    const r = await resolveRtScores({
      type,
      tmdbId,
      imdbId: opts?.imdbId,
      title,
      date,
    });

    if (!r.checked) {
      // Transient failure — keep imdb if any; do not bump rt_checked_at
      if (r.imdbId) {
        await withDbRetry(() =>
          db.update(table).set({ imdbId: r.imdbId }).where(eq(table.tmdbId, tmdbId))
        );
      }
      return;
    }

    const now = new Date();
    await withDbRetry(() =>
      db
        .update(table)
        .set({
          ...(r.imdbId ? { imdbId: r.imdbId } : {}),
          rtScore: r.score ?? RT_NONE,
          rtAudienceScore: r.audienceScore ?? RT_NONE,
          mcScore: r.mcScore ?? RT_NONE,
          rtCheckedAt: now,
          updatedAt: now,
        })
        .where(eq(table.tmdbId, tmdbId))
    );
  } catch (err) {
    console.error(
      `fillRtScore failed for ${type} ${tmdbId}:`,
      err instanceof Error ? err.message : err
    );
  }
}

function isRtStale(rtCheckedAt: Date | string | null | undefined): boolean {
  if (rtCheckedAt == null) return true; // never stamped → refresh
  const t =
    rtCheckedAt instanceof Date
      ? rtCheckedAt.getTime()
      : new Date(rtCheckedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t >= RT_STALE_MS;
}

/**
 * Kick off a background RT fill when:
 * - we have never resolved a score (`rt_score` null), or
 * - the last successful check is ≥ 2 weeks old (refresh Tomatometer)
 */
function ensureRtScore(
  row: {
    tmdbId: number;
    rtScore?: number | null;
    rtCheckedAt?: Date | string | null;
    imdbId?: string | null;
    title?: string | null;
    firstAirDate?: string | null;
    releaseDate?: string | null;
  },
  type: "tv" | "movie"
) {
  const needsFirst = row.rtScore == null;
  const needsRefresh = !needsFirst && isRtStale(row.rtCheckedAt);
  if (!needsFirst && !needsRefresh) return;

  const key = `${type}:${row.tmdbId}`;
  if (rtInFlight.has(key)) return;
  rtInFlight.add(key);
  void fillRtScore(row.tmdbId, type, {
    imdbId: row.imdbId,
    title: row.title,
    firstAirDate: row.firstAirDate,
    releaseDate: row.releaseDate,
  }).finally(() => rtInFlight.delete(key));
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

  // Await parent row so follow / FK writes never race a background insert
  try {
    await withDbRetry(() => persistShow(show));
    ensureRtScore({ ...show, tmdbId }, "tv");
  } catch (err) {
    console.error(`Failed to persist show ${tmdbId}:`, err);
  }

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

  try {
    await withDbRetry(() => persistMovie(movie));
    ensureRtScore({ ...movie, tmdbId }, "movie");
  } catch (err) {
    console.error(`Failed to persist movie ${tmdbId}:`, err);
  }

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
  numberOfSeasons: number,
  title?: string | null,
  networks?: string[] | null,
  firstAirDate?: string | null
): Promise<EpisodeInfo[]> {
  const fetchedEpisodes: EpisodeInfo[] = [];

  // Apple TV+ episodes: TMDB records the Pacific date (1 day early); TVMaze
  // carries the official Eastern date. Overlay TVMaze so air dates match
  // Apple/Google/RT for the whole show.
  const tvmazeAirdates =
    title && isAppleTv(networks)
      ? await getTvmazeAirdateMap(title, firstAirDate)
      : null;

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
          airDate:
            tvmazeAirdates?.get(`${ep.season_number}:${ep.episode_number}`) ??
            ep.air_date ??
            null,
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
  // Apple TV+ overlay: TMDB's Pacific date is 1 day early; TVMaze has the
  // official Eastern date (matches Apple/Google/RT).
  const tvmazeAirdates = isAppleTv(show.networks)
    ? await getTvmazeAirdateMap(show.title, show.firstAirDate)
    : null;
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
          airDate:
            tvmazeAirdates?.get(`${ep.season_number}:${ep.episode_number}`) ??
            ep.air_date ??
            null,
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

  // Show metadata for the Apple TV+ airdate overlay (title, networks, year).
  let showMeta: { title?: string | null; networks?: string[] | null; firstAirDate?: string | null } = {};
  try {
    const row = await withDbRetry(() =>
      db.query.shows.findFirst({ where: eq(shows.tmdbId, tmdbId) })
    );
    if (row) {
      showMeta = {
        title: row.title,
        networks: row.networks,
        firstAirDate: row.firstAirDate,
      };
    }
  } catch {
    /* overlay is best-effort; fall back to TMDB dates */
  }

  const fetchedEpisodes = await fetchEpisodesFromTmdb(
    tmdbId,
    numberOfSeasons,
    showMeta.title,
    showMeta.networks,
    showMeta.firstAirDate
  );

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
