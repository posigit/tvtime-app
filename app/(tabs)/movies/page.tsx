import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { movies, userMovies } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { ViewToggle } from "@/components/view-toggle";
import { SectionLabel } from "@/components/section-label";
import { posterUrl } from "@/lib/tmdb";
import Link from "next/link";
import Image from "next/image";

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
                    <div style={{aspectRatio:"2 / 3"}} className="relative bg-secondary">
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
                    <div style={{aspectRatio:"2 / 3"}} className="relative bg-secondary">
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
            <div className="flex flex-col items-center justify-center pt-24 text-center">
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-card">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-muted-foreground"
                >
                  <rect x="2" y="2" width="20" height="20" rx="2.18" />
                  <line x1="7" y1="2" x2="7" y2="22" />
                  <line x1="17" y1="2" x2="17" y2="22" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <line x1="2" y1="7" x2="7" y2="7" />
                  <line x1="2" y1="17" x2="7" y2="17" />
                  <line x1="17" y1="17" x2="22" y2="17" />
                  <line x1="17" y1="7" x2="22" y2="7" />
                </svg>
              </div>
              <h2 className="mb-2 text-lg font-bold text-white">No movies yet</h2>
              <p className="mb-6 max-w-xs text-sm text-muted-foreground">
                Browse popular movies and add them to your watch list.
              </p>
              <Link
                href="/explore"
                className="rounded-full bg-primary px-6 py-3 text-sm font-bold text-black"
              >
                BROWSE ALL MOVIES
              </Link>
            </div>
          )}
        </>
      )}

      {currentView === "upcoming" && (
        <div className="flex flex-col items-center justify-center pt-24 text-center">
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-card">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-muted-foreground"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <h2 className="mb-2 text-lg font-bold text-white">No upcoming movies</h2>
          <p className="mb-6 max-w-xs text-sm text-muted-foreground">
            Movies you want to watch will appear here.
          </p>
          <Link
            href="/explore"
            className="rounded-full bg-primary px-6 py-3 text-sm font-bold text-black"
          >
            BROWSE ALL MOVIES
          </Link>
        </div>
      )}
    </div>
  );
}
