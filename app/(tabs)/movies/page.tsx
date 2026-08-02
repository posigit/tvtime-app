import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { movies, userMovies } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { ShowTabs } from "@/components/show-tabs";
import { SectionLabel } from "@/components/section-label";
import { RatingBadge } from "@/components/star-rating";
import { posterUrl } from "@/lib/tmdb";
import {
  isUnreleased,
  splitWatchNextAndLater,
} from "@/lib/movie-watchlist";
import { WatchLaterTools } from "@/components/watch-later-tools";
import Link from "next/link";
import Image from "next/image";

function PopcornIllustration() {
  return (
    <div className="relative my-8 flex h-44 w-44 items-center justify-center">
      <div className="absolute inset-0 rounded-full bg-[#8ac249]" />
      <svg
        width="120"
        height="120"
        viewBox="0 0 120 120"
        className="relative z-10"
        aria-hidden
      >
        {/* Bucket */}
        <path
          d="M32 52 L39 100 H81 L88 52 Z"
          fill="#e0202e"
          stroke="#0f0f0f"
          strokeWidth="2"
        />
        <path d="M40 52 L45 100 H55 L52 52 Z" fill="#fff" />
        <path d="M65 52 L68 100 H78 L75 52 Z" fill="#fff" />
        {/* Popcorn */}
        <circle cx="42" cy="42" r="9" fill="#f6e7c8" stroke="#0f0f0f" strokeWidth="2" />
        <circle cx="56" cy="34" r="10" fill="#fdf3dd" stroke="#0f0f0f" strokeWidth="2" />
        <circle cx="70" cy="40" r="9" fill="#f6e7c8" stroke="#0f0f0f" strokeWidth="2" />
        <circle cx="80" cy="48" r="8" fill="#fdf3dd" stroke="#0f0f0f" strokeWidth="2" />
        <circle cx="36" cy="50" r="7" fill="#fdf3dd" stroke="#0f0f0f" strokeWidth="2" />
        <circle cx="62" cy="46" r="8" fill="#f6e7c8" stroke="#0f0f0f" strokeWidth="2" />
        <circle cx="50" cy="48" r="7" fill="#f9edd4" stroke="#0f0f0f" strokeWidth="2" />
      </svg>
      {/* Sparkles */}
      <span className="absolute -left-6 top-6 text-2xl text-[#b455f6]">✦</span>
      <span className="absolute -left-10 top-16 text-xl text-[#7ed321]">✦</span>
      <span className="absolute -right-6 top-8 text-2xl text-[#f5a623]">✦</span>
      <span className="absolute -right-9 bottom-12 text-lg text-[#7ed321]">✕</span>
      <span className="absolute -left-8 bottom-8 text-lg text-[#f5a623]">●</span>
      <span className="absolute -left-4 bottom-16 text-sm text-[#f5c518]">＋</span>
      <span className="absolute -top-3 right-8 text-lg text-[#b455f6]">●</span>
    </div>
  );
}

function EmptyState({
  title,
  description,
  cta,
}: {
  title: string;
  description: string;
  cta: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center pt-16 text-center">
      <h2 className="text-2xl font-bold text-white">{title}</h2>
      <PopcornIllustration />
      <p className="mb-8 max-w-xs text-[15px] text-white/80">{description}</p>
      <Link
        href="/explore"
        className="rounded-full bg-primary px-8 py-3.5 text-sm font-black uppercase tracking-wide text-black"
      >
        {cta}
      </Link>
    </div>
  );
}

function MoviePoster({
  title,
  posterPath,
  rating,
}: {
  title: string;
  posterPath: string | null;
  rating?: number | null;
}) {
  return (
    <div
      style={{ aspectRatio: "2 / 3" }}
      className="relative w-full overflow-hidden bg-secondary"
    >
      {rating != null && <RatingBadge value={rating} />}
      {posterPath ? (
        <Image
          src={posterUrl(posterPath, "w342") ?? ""}
          alt={title}
          fill
          sizes="(max-width: 768px) 33vw, 200px"
          className="object-cover"
          unoptimized
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[#3a7bd5] p-2 text-center">
          <span className="text-xs font-medium text-white">{title}</span>
        </div>
      )}
    </div>
  );
}

function MovieGrid({
  items,
}: {
  items: {
    tmdbId: number;
    title: string;
    posterPath: string | null;
    rating?: number | null;
  }[];
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((movie) => (
        <Link
          key={movie.tmdbId}
          href={`/movie/${movie.tmdbId}`}
          className="overflow-hidden rounded-md bg-card"
        >
          <MoviePoster
            title={movie.title}
            posterPath={movie.posterPath}
            rating={movie.rating}
          />
        </Link>
      ))}
    </div>
  );
}

function formatReleaseDate(releaseDate: string): string {
  return new Date(releaseDate + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Upcoming (unreleased) movie tiles with the release date under the poster. */
function UpcomingMovieGrid({
  items,
}: {
  items: {
    tmdbId: number;
    title: string;
    posterPath: string | null;
    releaseDate: string | null;
    rating?: number | null;
  }[];
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((movie) => (
        <Link
          key={movie.tmdbId}
          href={`/movie/${movie.tmdbId}`}
          className="overflow-hidden rounded-md bg-card"
        >
          <MoviePoster
            title={movie.title}
            posterPath={movie.posterPath}
            rating={movie.rating}
          />
          {movie.releaseDate && (
            <p className="px-1.5 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-primary">
              {formatReleaseDate(movie.releaseDate)}
            </p>
          )}
        </Link>
      ))}
    </div>
  );
}

export default async function MoviesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const currentView = view === "upcoming" ? "upcoming" : "watchlist";

  const userId = await requireAuth();

  const userMoviesList = await db
    .select({
      tmdbId: movies.tmdbId,
      title: movies.title,
      posterPath: movies.posterPath,
      releaseDate: movies.releaseDate,
      runtime: movies.runtime,
      rtScore: movies.rtScore,
      status: userMovies.status,
      watchedAt: userMovies.watchedAt,
      rating: userMovies.rating,
      updatedAt: userMovies.updatedAt,
    })
    .from(userMovies)
    .innerJoin(movies, eq(userMovies.tmdbId, movies.tmdbId))
    .where(eq(userMovies.userId, userId));

  const wantToWatchAll = userMoviesList.filter(
    (m) => m.status === "want_to_watch" || m.status === "for_later"
  );

  // Unreleased → Upcoming tab. Released/undated → Watch Next vs Watch Later.
  const releasedUnwatched = wantToWatchAll.filter((m) => !isUnreleased(m.releaseDate));
  const { watchNext, watchLater } = splitWatchNextAndLater(releasedUnwatched);

  const upcomingMovies = wantToWatchAll
    .filter((m) => isUnreleased(m.releaseDate))
    .sort((a, b) =>
      (a.releaseDate || "").localeCompare(b.releaseDate || "") ||
      (a.title || "").localeCompare(b.title || "")
    );

  // Group upcoming by release month ("DECEMBER 2026")
  const upcomingGroups = new Map<string, typeof upcomingMovies>();
  for (const m of upcomingMovies) {
    const key = new Date(m.releaseDate! + "T12:00:00")
      .toLocaleDateString("en-US", { month: "long", year: "numeric" })
      .toUpperCase();
    const arr = upcomingGroups.get(key);
    if (arr) arr.push(m);
    else upcomingGroups.set(key, [m]);
  }

  const watched = userMoviesList
    .filter((m) => m.status === "watched")
    .sort((a, b) => (b.watchedAt?.getTime() ?? 0) - (a.watchedAt?.getTime() ?? 0));

  return (
    <div className="min-h-dvh bg-black px-4 pb-nav-page">
      <div className="sticky top-0 z-10 bg-black pb-1 pt-safe">
        <div className="pt-2">
          <ShowTabs
            tabs={[
              { value: "watchlist", label: "WATCH LIST" },
              { value: "upcoming", label: "UPCOMING" },
            ]}
          />
        </div>
      </div>

      {currentView === "watchlist" && (
        <>
          {watchNext.length > 0 && (
            <section className="mb-6">
              <div className="relative mb-3 mt-2 flex justify-center">
                <SectionLabel>Watch Next</SectionLabel>
                <div className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-primary">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="3" y="3" width="8" height="8" rx="1.5" />
                    <rect x="13" y="3" width="8" height="8" rx="1.5" />
                    <rect x="3" y="13" width="8" height="8" rx="1.5" />
                    <rect x="13" y="13" width="8" height="8" rx="1.5" />
                  </svg>
                </div>
              </div>
              <MovieGrid items={watchNext} />
            </section>
          )}

          {watchLater.length > 0 && (
            <WatchLaterTools
              items={watchLater.map((m) => ({
                tmdbId: m.tmdbId,
                title: m.title,
                posterPath: m.posterPath,
                releaseDate: m.releaseDate,
                runtime: m.runtime,
                rtScore: m.rtScore,
                rating: m.rating,
              }))}
            />
          )}

          {watched.length > 0 && (
            <section className="mb-6">
              <div className="mb-3 flex justify-center">
                <SectionLabel>Recently Watched</SectionLabel>
              </div>
              <MovieGrid items={watched.slice(0, 30)} />
            </section>
          )}

          {userMoviesList.length === 0 && (
            <EmptyState
              title="Your watch list is empty!"
              description="Add movies you want to watch."
              cta="Browse all movies"
            />
          )}
        </>
      )}

      {currentView === "upcoming" && (
        <>
          {upcomingMovies.length > 0 ? (
            Array.from(upcomingGroups.entries()).map(([label, items]) => (
              <section key={label} className="mb-6">
                <div className="mb-3 mt-2 flex justify-center">
                  <SectionLabel>{label}</SectionLabel>
                </div>
                <UpcomingMovieGrid items={items} />
              </section>
            ))
          ) : (
            <EmptyState
              title="Your upcoming list is empty!"
              description="Movies you want to watch that haven't released yet will show up here."
              cta="Browse all movies"
            />
          )}
        </>
      )}
    </div>
  );
}
