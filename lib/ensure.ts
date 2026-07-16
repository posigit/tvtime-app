import { db } from "./db";
import { shows, movies } from "./schema";
import { getTvDetails, getMovieDetails } from "./tmdb";
import { eq } from "drizzle-orm";

export async function ensureShow(tmdbId: number) {
  const existing = await db.query.shows.findFirst({
    where: eq(shows.tmdbId, tmdbId),
  });
  if (existing) return existing;

  const details = await getTvDetails(tmdbId);
  await db
    .insert(shows)
    .values({
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
    })
    .onConflictDoNothing();

  return db.query.shows.findFirst({ where: eq(shows.tmdbId, tmdbId) });
}

export async function ensureMovie(tmdbId: number) {
  const existing = await db.query.movies.findFirst({
    where: eq(movies.tmdbId, tmdbId),
  });
  if (existing) return existing;

  const details = await getMovieDetails(tmdbId);
  await db
    .insert(movies)
    .values({
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
    })
    .onConflictDoNothing();

  return db.query.movies.findFirst({ where: eq(movies.tmdbId, tmdbId) });
}
