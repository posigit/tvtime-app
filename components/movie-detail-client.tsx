"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { backdropUrl, posterUrl, type TmdbMediaCard, type WatchProvidersResult } from "@/lib/tmdb";
import { MovieWatchButton } from "@/components/movie-watch-button";
import { MovieRating } from "@/components/star-rating";
import { DiscoverRail } from "@/components/discover-rail";
import { WatchProviders } from "@/components/watch-providers";
import { ChevronLeft } from "lucide-react";

export type MovieDetailData = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string | null;
  releaseDate: string | null;
  runtime: number | null;
  status: string | null;
  voteAverage: number | null;
  rtScore: number | null;
};

function formatRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function MovieDetailClient({
  movie,
  initialStatus,
  initialRating,
  moreLikeThis,
  recommended,
  providers,
  followedShowIds,
  movieStatusById,
}: {
  movie: MovieDetailData;
  initialStatus: string | null;
  initialRating: number | null;
  moreLikeThis: TmdbMediaCard[];
  recommended: TmdbMediaCard[];
  providers: WatchProvidersResult;
  followedShowIds?: Set<number>;
  movieStatusById?: Map<number, string | null | undefined>;
}) {
  const router = useRouter();

  const metaParts: string[] = [];
  if (movie.releaseDate) metaParts.push(movie.releaseDate.slice(0, 4));
  if (movie.runtime) metaParts.push(formatRuntime(movie.runtime));
  if (movie.status && movie.status !== "Released") metaParts.push(movie.status);

  const critic =
    movie.rtScore != null && movie.rtScore >= 0
      ? { icon: "rt" as const, text: `${movie.rtScore}%` }
      : movie.voteAverage
        ? { icon: "tmdb" as const, text: `${movie.voteAverage.toFixed(1)}` }
        : null;

  const poster = posterUrl(movie.posterPath, "w342");
  const backdrop =
    backdropUrl(movie.backdropPath, "w1280") ||
    posterUrl(movie.posterPath, "w780");

  return (
    <div className="min-h-dvh bg-black pb-safe-page">
      {/* ---------- Hero ---------- */}
      <div className="relative">
        <div className="relative h-[min(52vw,16rem)] w-full overflow-hidden sm:h-64">
          {backdrop ? (
            <Image
              src={backdrop}
              alt=""
              fill
              sizes="100vw"
              className="object-cover"
              unoptimized
              priority
            />
          ) : (
            <div className="h-full w-full bg-card" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/25" />

          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back"
            className="absolute left-4 top-safe-float z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>

        {/* Poster + title stack overlapping hero */}
        <div className="relative z-10 -mt-16 px-4">
          <div className="flex items-end gap-3.5">
            <div className="relative h-40 w-[6.75rem] flex-shrink-0 overflow-hidden rounded-xl bg-secondary shadow-2xl ring-2 ring-white/10">
              {poster ? (
                <Image
                  src={poster}
                  alt={movie.title}
                  fill
                  sizes="108px"
                  className="object-cover"
                  unoptimized
                  priority
                />
              ) : (
                <div className="flex h-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
                  {movie.title}
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 pb-1">
              <h1 className="text-2xl font-black leading-tight text-white drop-shadow">
                {movie.title}
              </h1>
              {metaParts.length > 0 && (
                <p className="mt-1 text-sm text-white/70">
                  {metaParts.join(" · ")}
                </p>
              )}
              {critic && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 backdrop-blur-sm">
                  {critic.icon === "rt" ? (
                    <span className="text-base leading-none" title="Rotten Tomatoes">
                      🍅
                    </span>
                  ) : (
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded bg-primary text-[10px] font-black text-black"
                      title="TMDB"
                    >
                      T
                    </span>
                  )}
                  <span className="text-sm font-bold text-primary">
                    {critic.text}
                    {critic.icon === "tmdb" ? "/10" : ""}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Actions card ---------- */}
      <div className="mt-5 px-4">
        <div className="rounded-2xl border border-white/10 bg-card p-4 shadow-lg">
          <MovieWatchButton
            tmdbId={movie.tmdbId}
            initialStatus={initialStatus}
            variant="full"
          />

          <div className="mt-4 border-t border-white/10 pt-4">
            <MovieRating
              tmdbId={movie.tmdbId}
              initialRating={initialRating}
            />
          </div>
        </div>

        {movie.overview && (
          <section className="mt-5">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Overview
            </h2>
            <p className="text-[15px] leading-relaxed text-white/90">
              {movie.overview}
            </p>
          </section>
        )}

        <WatchProviders providers={providers} />

        <div className="mt-6">
          <DiscoverRail
            label={`More like ${movie.title}`}
            items={moreLikeThis}
            followedShowIds={followedShowIds}
            movieStatusById={movieStatusById}
          />
          <DiscoverRail
            label="You might also like"
            items={recommended}
            followedShowIds={followedShowIds}
            movieStatusById={movieStatusById}
          />
        </div>

        <p className="mt-8 pb-4 text-center text-[11px] text-muted-foreground">
          <Link href="/movies" className="text-white/60 underline-offset-2 hover:underline">
            Back to Movies
          </Link>
        </p>
      </div>
    </div>
  );
}
