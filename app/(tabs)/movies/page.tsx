import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { movies, userMovies } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { ViewToggle } from "@/components/view-toggle";
import { SectionLabel } from "@/components/section-label";
import { posterUrl } from "@/lib/tmdb";
import Link from "next/link";
import Image from "next/image";

function PopcornEmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center pt-24 text-center">
      {/* Popcorn-style illustration (CSS/SVG, matches snapshot empty state vibe) */}
      <div className="relative mb-6 flex h-28 w-28 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-emerald-500/90" />
        <svg
          width="72"
          height="72"
          viewBox="0 0 72 72"
          className="relative z-10"
          aria-hidden
        >
          {/* Bucket */}
          <path
            d="M18 30 L22 62 H50 L54 30 Z"
            fill="#e11d2e"
            stroke="#fff"
            strokeWidth="1.5"
          />
          <path d="M22 30 L25 62 H33 L30 30 Z" fill="#fff" opacity="0.95" />
          <path d="M39 30 L42 62 H50 L47 30 Z" fill="#fff" opacity="0.95" />
          <ellipse cx="36" cy="30" rx="20" ry="6" fill="#e11d2e" />
          {/* Popcorn kernels */}
          <circle cx="28" cy="22" r="5" fill="#fbbf24" />
          <circle cx="36" cy="18" r="6" fill="#fcd34d" />
          <circle cx="44" cy="22" r="5" fill="#fbbf24" />
          <circle cx="32" cy="26" r="4" fill="#fde68a" />
          <circle cx="40" cy="26" r="4" fill="#fcd34d" />
          {/* Sparkles */}
          <circle cx="16" cy="16" r="2" fill="#a3e635" />
          <circle cx="56" cy="14" r="2" fill="#c084fc" />
          <circle cx="52" cy="28" r="1.5" fill="#f472b6" />
          <circle cx="20" cy="28" r="1.5" fill="#38bdf8" />
        </svg>
      </div>
      <h2 className="mb-2 text-lg font-bold text-white">{title}</h2>
      <p className="mb-6 max-w-xs text-sm text-muted-foreground">{description}</p>
      <Link
        href="/explore"
        className="rounded-full bg-primary px-6 py-3 text-sm font-bold text-black"
      >
        BROWSE ALL MOVIES
      </Link>
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
      status: userMovies.status,
      watchedAt: userMovies.watchedAt,
    })
    .from(userMovies)
    .innerJoin(movies, eq(userMovies.tmdbId, movies.tmdbId))
    .where(eq(userMovies.userId, userId));

  const wantToWatch = userMoviesList
    .filter((m) => m.status === "want_to_watch" || m.status === "for_later")
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""));

  const watched = userMoviesList
    .filter((m) => m.status === "watched")
    .sort((a, b) => (b.watchedAt?.getTime() ?? 0) - (a.watchedAt?.getTime() ?? 0));

  return (
    <div className="min-h-screen bg-black px-4 py-4">
      <div className="mb-6 sticky top-0 z-10 bg-black pb-2 pt-2">
        <ViewToggle
          segments={[
            { value: "watchlist", label: "WATCH LIST" },
            { value: "upcoming", label: "UPCOMING" },
          ]}
        />
      </div>

      {currentView === "watchlist" && (
        <>
          {wantToWatch.length > 0 && (
            <section className="mb-6">
              <div className="mb-3">
                <SectionLabel>Watch Next</SectionLabel>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {wantToWatch.map((movie) => (
                  <Link
                    key={movie.tmdbId}
                    href={`/movie/${movie.tmdbId}`}
                    className="overflow-hidden rounded-lg bg-card"
                  >
                    <div style={{ aspectRatio: "2 / 3" }} className="relative bg-secondary">
                      {movie.posterPath ? (
                        <Image
                          src={posterUrl(movie.posterPath, "w342") ?? ""}
                          alt={movie.title}
                          fill
                          sizes="(max-width: 768px) 33vw, 200px"
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
                          {movie.title}
                        </div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {watched.length > 0 && (
            <section className="mb-6">
              <div className="mb-3">
                <SectionLabel>Recently Watched</SectionLabel>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {watched.slice(0, 30).map((movie) => (
                  <Link
                    key={movie.tmdbId}
                    href={`/movie/${movie.tmdbId}`}
                    className="overflow-hidden rounded-lg bg-card"
                  >
                    <div style={{ aspectRatio: "2 / 3" }} className="relative bg-secondary">
                      {movie.posterPath ? (
                        <Image
                          src={posterUrl(movie.posterPath, "w342") ?? ""}
                          alt={movie.title}
                          fill
                          sizes="(max-width: 768px) 33vw, 200px"
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
                          {movie.title}
                        </div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {userMoviesList.length === 0 && (
            <PopcornEmptyState
              title="Your watch list is empty!"
              description="Add movies you want to watch."
            />
          )}
        </>
      )}

      {currentView === "upcoming" && (
        <PopcornEmptyState
          title="Your upcoming list is empty!"
          description="Add movies you want to watch."
        />
      )}
    </div>
  );
}
