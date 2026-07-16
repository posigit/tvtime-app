import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { shows, movies, userShows, userMovies, watchedEpisodes, userLists } from "@/lib/schema";
import { eq, sql, count } from "drizzle-orm";
import { posterUrl } from "@/lib/tmdb";
import Link from "next/link";
import { Bell, Heart } from "lucide-react";

export default async function ProfilePage() {
  const session = await auth();
  const userId = session!.user.id;

  const [showCount] = await db
    .select({ value: count() })
    .from(userShows)
    .where(eq(userShows.userId, userId));

  const [movieCount] = await db
    .select({ value: count() })
    .from(userMovies)
    .where(eq(userMovies.userId, userId));

  const [watchedCount] = await db
    .select({ value: count() })
    .from(watchedEpisodes)
    .where(eq(watchedEpisodes.userId, userId));

  const [totalRuntime] = await db
    .select({ value: sql<number>`COALESCE(SUM(${shows.episodeRuntime}), 0)` })
    .from(watchedEpisodes)
    .innerJoin(shows, eq(watchedEpisodes.showTmdbId, shows.tmdbId))
    .where(eq(watchedEpisodes.userId, userId));

  const hoursWatched = Math.round((totalRuntime?.value || 0) / 60);

  const favoriteShows = await db
    .select({
      tmdbId: shows.tmdbId,
      title: shows.title,
      posterPath: shows.posterPath,
    })
    .from(userShows)
    .innerJoin(shows, eq(userShows.tmdbId, shows.tmdbId))
    .where(eq(userShows.userId, userId));

  const favShows = favoriteShows.filter((s) => true).slice(0, 12);

  const favoriteMovies = await db
    .select({
      tmdbId: movies.tmdbId,
      title: movies.title,
      posterPath: movies.posterPath,
    })
    .from(userMovies)
    .innerJoin(movies, eq(userMovies.tmdbId, movies.tmdbId))
    .where(eq(userMovies.userId, userId));

  const favMovies = favoriteMovies.slice(0, 12);

  const lists = await db
    .select()
    .from(userLists)
    .where(eq(userLists.userId, userId));

  return (
    <div className="min-h-screen bg-black px-4 py-4">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary">
          <Bell className="h-5 w-5 text-black" />
        </div>
      </div>

      <div className="mb-6 flex flex-col items-center">
        <div className="mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-card text-3xl font-bold text-primary">
          {session?.user?.name?.[0]?.toUpperCase() || "U"}
        </div>
        <h1 className="text-xl font-bold text-white">{session?.user?.name || "User"}</h1>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-card p-4 text-center">
          <p className="text-2xl font-bold text-primary">{showCount?.value || 0}</p>
          <p className="text-xs text-muted-foreground">Shows</p>
        </div>
        <div className="rounded-xl bg-card p-4 text-center">
          <p className="text-2xl font-bold text-primary">{movieCount?.value || 0}</p>
          <p className="text-xs text-muted-foreground">Movies</p>
        </div>
        <div className="rounded-xl bg-card p-4 text-center">
          <p className="text-2xl font-bold text-primary">{hoursWatched}</p>
          <p className="text-xs text-muted-foreground">Hours</p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-card p-4 text-center">
          <p className="text-2xl font-bold text-white">{watchedCount?.value || 0}</p>
          <p className="text-xs text-muted-foreground">Episodes Watched</p>
        </div>
        <Link
          href="/import"
          className="flex items-center justify-center rounded-xl border border-primary p-4 text-center text-sm font-medium text-primary"
        >
          Import Data
        </Link>
      </div>

      {favShows.length > 0 && (
        <section className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <Heart className="h-4 w-4 fill-red-500 text-red-500" />
            <h2 className="text-sm font-semibold text-white">Shows</h2>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {favShows.map((show) => (
              <Link
                key={show.tmdbId}
                href={`/show/${show.tmdbId}`}
                className="flex-shrink-0"
              >
                <div className="h-32 w-20 overflow-hidden rounded-lg bg-card">
                  {show.posterPath ? (
                    <img
                      src={posterUrl(show.posterPath, "w185") ?? ""}
                      alt={show.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center p-1 text-center text-[10px] text-muted-foreground">
                      {show.title}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {favMovies.length > 0 && (
        <section className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <Heart className="h-4 w-4 fill-red-500 text-red-500" />
            <h2 className="text-sm font-semibold text-white">Movies</h2>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {favMovies.map((movie) => (
              <Link
                key={movie.tmdbId}
                href={`/movie/${movie.tmdbId}`}
                className="flex-shrink-0"
              >
                <div className="h-32 w-20 overflow-hidden rounded-lg bg-card">
                  {movie.posterPath ? (
                    <img
                      src={posterUrl(movie.posterPath, "w185") ?? ""}
                      alt={movie.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center p-1 text-center text-[10px] text-muted-foreground">
                      {movie.title}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mb-6">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-white">Lists</h2>
        </div>
        <div className="space-y-2">
          {lists.map((list) => (
            <div
              key={list.id}
              className="flex items-center justify-between rounded-xl bg-card p-4"
            >
              <div>
                <p className="font-medium text-white">{list.name}</p>
                <p className="text-xs text-muted-foreground">
                  {Array.isArray(list.items) ? list.items.length : 0} items
                </p>
              </div>
            </div>
          ))}
          {lists.length === 0 && (
            <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-sm text-muted-foreground">
              No lists yet
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
