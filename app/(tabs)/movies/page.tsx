import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { movies, userMovies } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";
import { ViewToggle } from "@/components/view-toggle";
import { SectionLabel } from "@/components/section-label";
import { posterUrl } from "@/lib/tmdb";
import Link from "next/link";

export default async function MoviesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const currentView = view === "upcoming" ? "upcoming" : "watchlist";

  const session = await auth();
  const userId = session!.user.id;

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
                    <div style={{aspectRatio:"2 / 3"}} className="bg-secondary">
                      {movie.posterPath ? (
                        <img
                          src={posterUrl(movie.posterPath, "w342") ?? ""}
                          alt={movie.title}
                          className="h-full w-full object-cover"
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
                    <div style={{aspectRatio:"2 / 3"}} className="bg-secondary">
                      {movie.posterPath ? (
                        <img
                          src={posterUrl(movie.posterPath, "w342") ?? ""}
                          alt={movie.title}
                          className="h-full w-full object-cover"
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
            <div className="flex flex-col items-center justify-center pt-20">
              <p className="mb-4 text-muted-foreground">No movies in your watch list yet</p>
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
        <div className="flex flex-col items-center justify-center pt-20">
          <p className="mb-4 text-muted-foreground">No upcoming movies</p>
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
