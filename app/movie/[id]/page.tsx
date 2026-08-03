import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userMovies } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import {
  backdropUrl,
  getMovieCredits,
  getMovieRecommendations,
  getMovieSimilar,
  getWatchProviders,
  movieDirectors,
} from "@/lib/tmdb";
import { getCommunityReviews } from "@/lib/reviews";
import { ensureMovie } from "@/lib/ensure";
import { filterNewMedia } from "@/lib/recommend";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft } from "lucide-react";
import { MovieWatchButton } from "@/components/movie-watch-button";
import { MovieRating } from "@/components/star-rating";
import { DiscoverRail } from "@/components/discover-rail";
import { WatchProviders } from "@/components/watch-providers";
import { CommunityReviews } from "@/components/community-reviews";

function formatRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

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

  const [userMovie, ownedMovies] = await Promise.all([
    db.query.userMovies.findFirst({
      where: and(eq(userMovies.userId, userId), eq(userMovies.tmdbId, tmdbId)),
    }),
    db
      .select({ tmdbId: userMovies.tmdbId })
      .from(userMovies)
      .where(eq(userMovies.userId, userId)),
  ]);

  const ownedIds = new Set(ownedMovies.map((m) => m.tmdbId));

  const [similarRaw, recsRaw, providers, credits, reviews] = await Promise.all([
    getMovieSimilar(tmdbId).catch(() => []),
    getMovieRecommendations(tmdbId).catch(() => []),
    getWatchProviders(tmdbId, "movie").catch(() => ({
      flatrate: [],
      rent: [],
      buy: [],
    })),
    getMovieCredits(tmdbId).catch(() => null),
    getCommunityReviews({
      kind: "movie",
      tmdbId,
      title: movie.title,
      year: movie.releaseDate,
    }).catch(() => []),
  ]);

  const moreLikeThis = filterNewMedia(similarRaw, ownedIds, 12);
  const recommended = filterNewMedia(recsRaw, ownedIds, 12);
  const directors = movieDirectors(credits?.crew);
  const directorLabel = directors.length > 0 ? directors.join(", ") : null;

  const metaParts: string[] = [];
  if (movie.releaseDate) metaParts.push(movie.releaseDate.slice(0, 4));
  if (movie.runtime) metaParts.push(formatRuntime(movie.runtime));
  if (movie.status) metaParts.push(movie.status);

  // Big RT / TMDB badge (same as before — large and prominent on the hero)
  const rating =
    movie.rtScore != null && movie.rtScore >= 0
      ? { icon: "rt" as const, text: `${movie.rtScore}%` }
      : movie.voteAverage
        ? { icon: "tmdb" as const, text: `${movie.voteAverage.toFixed(1)}/10` }
        : null;

  const isWatched = userMovie?.status === "watched";

  return (
    <div className="min-h-dvh bg-black pb-safe-page">
      {/* ---------- Backdrop header (previous style you liked) ---------- */}
      <div className="relative h-detail-hero w-full overflow-hidden">
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
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/30" />

        <Link
          href="/movies"
          aria-label="Back to movies"
          className="absolute left-4 top-safe-float flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>

        {/* Title + large RT badge overlaid on backdrop */}
        <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-black text-white drop-shadow">
              {movie.title}
            </h1>
            {metaParts.length > 0 && (
              <p className="mt-0.5 truncate text-sm text-white/80">
                {metaParts.join(" · ")}
              </p>
            )}
          </div>
          {rating && (
            <div className="flex flex-shrink-0 items-center gap-1.5">
              {rating.icon === "rt" ? (
                <span className="text-xl leading-none" title="Rotten Tomatoes">
                  🍅
                </span>
              ) : (
                <span
                  className="flex h-6 w-6 items-center justify-center rounded bg-primary text-sm font-black text-black"
                  title="TMDB score"
                >
                  T
                </span>
              )}
              <span className="text-lg font-bold text-primary">
                {rating.text}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ---------- Body ---------- */}
      <div className="px-4 pt-4">
        <MovieWatchButton
          tmdbId={tmdbId}
          initialStatus={userMovie?.status || null}
        />

        {/* Your stars only after Mark Watched — not for unwatched titles */}
        {isWatched && (
          <div className="mt-4 border-b border-white/10 pb-4">
            <MovieRating
              tmdbId={tmdbId}
              initialRating={userMovie?.rating ?? null}
            />
          </div>
        )}

        {directorLabel && (
          <div className="mt-4 rounded-xl bg-card px-4 py-3">
            <div className="flex justify-between gap-3 text-sm">
              <span className="shrink-0 text-muted-foreground">
                {directors.length > 1 ? "Directors" : "Director"}
              </span>
              <span className="text-right font-medium text-white">
                {directorLabel}
              </span>
            </div>
          </div>
        )}

        {movie.overview && (
          <section className="mt-4">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Overview
            </h2>
            <p className="text-sm leading-relaxed text-white/90">
              {movie.overview}
            </p>
          </section>
        )}

        <WatchProviders providers={providers} />

        <CommunityReviews reviews={reviews} mediaTitle={movie.title} />

        <div className="mt-6">
          <DiscoverRail
            label={`More like ${movie.title}`}
            items={moreLikeThis}
          />
          <DiscoverRail label="Recommended for you" items={recommended} />
        </div>
      </div>
    </div>
  );
}
