import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userMovies } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { backdropUrl, posterUrl } from "@/lib/tmdb";
import { ensureMovie } from "@/lib/ensure";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft } from "lucide-react";
import { MovieWatchButton } from "@/components/movie-watch-button";
import { MovieRating } from "@/components/star-rating";

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

  const userMovie = await db.query.userMovies.findFirst({
    where: and(eq(userMovies.userId, userId), eq(userMovies.tmdbId, tmdbId)),
  });

  return (
    <div className="min-h-screen bg-black pb-20">
      <div className="relative h-48 w-full overflow-hidden">
        {movie.backdropPath ? (
          <Image
            src={backdropUrl(movie.backdropPath, "w1280") ?? ""}
            alt={movie.title}
            fill
            sizes="100vw"
            className="object-cover"
            unoptimized
            priority
          />
        ) : (
          <div className="h-full w-full bg-card" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
        <Link
          href="/movies"
          className="absolute left-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
      </div>

      <div className="-mt-12 px-4">
        <div className="flex gap-4">
          <div className="relative h-36 w-24 flex-shrink-0 overflow-hidden rounded-lg bg-secondary shadow-lg">
            {movie.posterPath ? (
              <Image
                src={posterUrl(movie.posterPath, "w342") ?? ""}
                alt={movie.title}
                width={96}
                height={144}
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                No img
              </div>
            )}
          </div>

          <div className="flex-1 pt-12">
            <h1 className="text-xl font-bold text-white">{movie.title}</h1>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {movie.releaseDate && (
                <span>{movie.releaseDate.slice(0, 4)}</span>
              )}
              {movie.runtime && (
                <>
                  <span>·</span>
                  <span>{Math.floor(movie.runtime / 60)}h {movie.runtime % 60}m</span>
                </>
              )}
              {movie.rtScore != null ? (
                <>
                  <span>·</span>
                  <span className="text-primary" title="Rotten Tomatoes">
                    🍅 {movie.rtScore}%
                  </span>
                </>
              ) : movie.voteAverage ? (
                <>
                  <span>·</span>
                  <span className="text-primary" title="TMDB score">
                    T {movie.voteAverage.toFixed(1)}/10
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        {movie.overview && (
          <p className="mt-4 text-sm text-muted-foreground">{movie.overview}</p>
        )}

        <div className="mt-6">
          <MovieWatchButton
            tmdbId={tmdbId}
            initialStatus={userMovie?.status || null}
          />
        </div>

        {userMovie && (
          <div className="mt-6">
            <MovieRating
              tmdbId={tmdbId}
              initialRating={userMovie.rating ?? null}
            />
          </div>
        )}
      </div>
    </div>
  );
}
