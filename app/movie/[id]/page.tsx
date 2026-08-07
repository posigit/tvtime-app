import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userMovies, watchHistory } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  backdropUrl,
  posterUrl,
  getMovieCredits,
  getMovieRecommendations,
  getMovieSimilar,
  getMovieVideos,
  getWatchProviders,
  movieDirectors,
  pickTrailerKey,
} from "@/lib/tmdb";
import { getCommunityReviews } from "@/lib/reviews";
import { ensureMovie } from "@/lib/ensure";
import { filterNewMedia } from "@/lib/recommend";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft } from "lucide-react";
import { MovieWatchButton } from "@/components/movie-watch-button";
import { FavoriteButton } from "@/components/favorite-button";
import { MovieRewatchButton } from "@/components/movie-rewatch-button";
import { MovieRating } from "@/components/star-rating";
import { DiscoverRail } from "@/components/discover-rail";
import { WatchProviders } from "@/components/watch-providers";
import { CommunityReviews } from "@/components/community-reviews";
import { ScoreStrip } from "@/components/score-strip";
import { TrailerButton } from "@/components/trailer-button";
import { MovieVixButton } from "@/components/movie-vix-button";
import { TmdbIcon } from "@/components/rt-icons";
import { getPlaybackPosition } from "@/lib/playback";

function formatRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Genre names from the cached TMDB details JSON (tmdb_data.genres). */
function genresFromTmdbData(tmdbData: unknown): string[] {
  if (!tmdbData || typeof tmdbData !== "object") return [];
  const genres = (tmdbData as { genres?: unknown }).genres;
  if (!Array.isArray(genres)) return [];
  return genres
    .map((g) =>
      g && typeof g === "object" && "name" in g
        ? String((g as { name: unknown }).name)
        : ""
    )
    .filter((name) => name.length > 0)
    .slice(0, 5);
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

  const [userMovie, ownedMovies, playback, movieRewatchCount] =
    await Promise.all([
      db.query.userMovies.findFirst({
        where: and(eq(userMovies.userId, userId), eq(userMovies.tmdbId, tmdbId)),
      }),
      db
        .select({ tmdbId: userMovies.tmdbId })
        .from(userMovies)
        .where(eq(userMovies.userId, userId)),
      getPlaybackPosition(userId, "movie", tmdbId),
      db
        .select({ count: sql<number>`count(*)` })
        .from(watchHistory)
        .where(
          and(
            eq(watchHistory.userId, userId),
            eq(watchHistory.mediaType, "movie"),
            eq(watchHistory.tmdbId, tmdbId)
          )
        ),
    ]);

  const ownedIds = new Set(ownedMovies.map((m) => m.tmdbId));

  const [similarRaw, recsRaw, providers, credits, reviews, videos] =
    await Promise.all([
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
        knownRtScore: movie.rtScore,
        knownRtAudienceScore: movie.rtAudienceScore,
        knownMcScore: movie.mcScore,
      }).catch(() => ({
        reviews: [],
        rtScore: movie.rtScore != null && movie.rtScore >= 0 ? movie.rtScore : null,
        rtAudienceScore:
          movie.rtAudienceScore != null && movie.rtAudienceScore >= 0
            ? movie.rtAudienceScore
            : null,
        mcScore: movie.mcScore != null && movie.mcScore >= 0 ? movie.mcScore : null,
        rtState: null,
        rtUrl: null,
        counts: { all: 0, rt: 0, tmdb: 0, reddit: 0, fresh: 0, rotten: 0 },
      })),
      getMovieVideos(tmdbId).catch(() => []),
    ]);

  const moreLikeThis = filterNewMedia(similarRaw, ownedIds, 12);
  const recommended = filterNewMedia(recsRaw, ownedIds, 12);
  const directors = movieDirectors(credits?.crew);
  const directorLabel = directors.length > 0 ? directors.join(", ") : null;
  const cast = (credits?.cast ?? []).slice(0, 12);
  const genres = genresFromTmdbData(movie.tmdbData);
  const trailerKey = pickTrailerKey(videos);

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
      {/* ---------- Backdrop header ---------- */}
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
          className="absolute left-4 top-safe-float z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>

        {/* Centered play button opens the trailer */}
        {trailerKey && (
          <TrailerButton
            trailerKey={trailerKey}
            title={movie.title}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/55 px-5 py-3 text-sm ring-1 ring-white/25"
          />
        )}

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
                <TmdbIcon className="h-6 w-6" />
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
        <MovieVixButton
          tmdbId={tmdbId}
          title={movie.title}
          isWatched={isWatched}
          playback={playback}
        />

        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1">
            <MovieWatchButton
              tmdbId={tmdbId}
              initialStatus={userMovie?.status || null}
            />
          </div>
          {isWatched && (
            <FavoriteButton
              mediaType="movie"
              tmdbId={tmdbId}
              initialFavorite={userMovie?.favorite ?? false}
            />
          )}
          {isWatched && (
            <MovieRewatchButton
              tmdbId={tmdbId}
              initialCount={Number(movieRewatchCount[0]?.count ?? 0)}
            />
          )}
        </div>

        {/* Critic + audience scores */}
        <ScoreStrip
          className="mt-4"
          rtScore={reviews.rtScore}
          rtAudienceScore={reviews.rtAudienceScore}
          voteAverage={movie.voteAverage}
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

        {/* Genres */}
        {genres.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {genres.map((g) => (
              <span
                key={g}
                className="rounded-full bg-white/[0.06] px-3 py-1 text-[11px] font-semibold text-white/70 ring-1 ring-white/[0.08]"
              >
                {g}
              </span>
            ))}
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

        {/* Top-billed cast */}
        {cast.length > 0 && (
          <section className="mt-5">
            <h2 className="mb-2.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Cast
            </h2>
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 scrollbar-none">
              {cast.map((person) => {
                const photo = posterUrl(person.profile_path, "w185");
                return (
                  <div
                    key={person.id}
                    className="w-16 flex-shrink-0 text-center"
                  >
                    <div className="relative mx-auto h-16 w-16 overflow-hidden rounded-full bg-secondary ring-1 ring-white/10">
                      {photo ? (
                        <Image
                          src={photo}
                          alt={person.name}
                          fill
                          sizes="64px"
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-lg font-black text-white/30">
                          {person.name.charAt(0)}
                        </div>
                      )}
                    </div>
                    <p className="mt-1.5 truncate text-[11px] font-semibold leading-tight text-white/90">
                      {person.name}
                    </p>
                    {person.character && (
                      <p className="truncate text-[10px] leading-tight text-white/40">
                        {person.character}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
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

        <WatchProviders providers={providers} />

        <CommunityReviews payload={reviews} mediaTitle={movie.title} />

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
