import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userMovies, userShows } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import {
  getMovieRecommendations,
  getMovieSimilar,
  getWatchProviders,
} from "@/lib/tmdb";
import { ensureMovie } from "@/lib/ensure";
import { filterNewMedia } from "@/lib/recommend";
import { notFound } from "next/navigation";
import { MovieDetailClient } from "@/components/movie-detail-client";

export default async function MovieDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tmdbId = Number(id);
  if (!Number.isFinite(tmdbId)) notFound();

  const userId = await requireAuth();

  const movie = await ensureMovie(tmdbId);
  if (!movie) notFound();

  const [userMovie, ownedMovies, ownedShows] = await Promise.all([
    db.query.userMovies.findFirst({
      where: and(eq(userMovies.userId, userId), eq(userMovies.tmdbId, tmdbId)),
    }),
    db
      .select({ tmdbId: userMovies.tmdbId, status: userMovies.status })
      .from(userMovies)
      .where(eq(userMovies.userId, userId)),
    db
      .select({ tmdbId: userShows.tmdbId })
      .from(userShows)
      .where(eq(userShows.userId, userId)),
  ]);

  const ownedIds = new Set(ownedMovies.map((m) => m.tmdbId));
  const followedShowIds = new Set(ownedShows.map((s) => s.tmdbId));
  const movieStatusById = new Map(
    ownedMovies.map((m) => [m.tmdbId, m.status] as const)
  );

  const [similarRaw, recsRaw, providers] = await Promise.all([
    getMovieSimilar(tmdbId).catch(() => []),
    getMovieRecommendations(tmdbId).catch(() => []),
    getWatchProviders(tmdbId, "movie").catch(() => ({
      flatrate: [],
      rent: [],
      buy: [],
    })),
  ]);

  const moreLikeThis = filterNewMedia(similarRaw, ownedIds, 12);
  const recommended = filterNewMedia(recsRaw, ownedIds, 12);

  return (
    <MovieDetailClient
      movie={{
        tmdbId,
        title: movie.title,
        posterPath: movie.posterPath,
        backdropPath: movie.backdropPath,
        overview: movie.overview,
        releaseDate: movie.releaseDate,
        runtime: movie.runtime,
        status: movie.status,
        voteAverage: movie.voteAverage,
        rtScore: movie.rtScore ?? null,
      }}
      initialStatus={userMovie?.status || null}
      initialRating={userMovie?.rating ?? null}
      moreLikeThis={moreLikeThis}
      recommended={recommended}
      providers={providers}
      followedShowIds={followedShowIds}
      movieStatusById={movieStatusById}
    />
  );
}
