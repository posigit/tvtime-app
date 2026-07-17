import { auth, requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { shows, movies, userShows, userMovies, watchedEpisodes, userLists } from "@/lib/schema";
import { eq, sql, count, desc } from "drizzle-orm";
import { posterUrl } from "@/lib/tmdb";
import Link from "next/link";
import Image from "next/image";
import { Bell, Heart, Film, Tv, Clock, Settings } from "lucide-react";
import { LogoutButton } from "@/components/logout-button";

export default async function ProfilePage() {
  const userId = await requireAuth();
  const session = await auth();

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
    .where(eq(userShows.userId, userId))
    .orderBy(desc(userShows.updatedAt))
    .limit(12);

  const favoriteMovies = await db
    .select({
      tmdbId: movies.tmdbId,
      title: movies.title,
      posterPath: movies.posterPath,
    })
    .from(userMovies)
    .innerJoin(movies, eq(userMovies.tmdbId, movies.tmdbId))
    .where(eq(userMovies.userId, userId))
    .orderBy(desc(userMovies.updatedAt))
    .limit(12);

  const lists = await db
    .select()
    .from(userLists)
    .where(eq(userLists.userId, userId));

  const initial = session?.user?.name?.[0]?.toUpperCase() || "U";
  const name = session?.user?.name || "User";

  return (
    <div className="min-h-screen bg-black px-4 py-4 pb-24">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-bold text-white">Profile</h1>
        <button className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-muted-foreground">
          <Bell className="h-5 w-5" />
        </button>
      </div>

      {/* Avatar + Name */}
      <div className="mb-6 flex flex-col items-center">
        <div className="mb-3 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 text-3xl font-bold text-primary ring-2 ring-primary/20">
          {initial}
        </div>
        <h2 className="text-xl font-bold text-white">{name}</h2>
        <p className="text-sm text-muted-foreground">TV Time member</p>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-4 gap-2">
        <div className="rounded-xl bg-card p-3 text-center">
          <p className="text-lg font-bold text-primary">{showCount?.value || 0}</p>
          <p className="text-[10px] text-muted-foreground">Shows</p>
        </div>
        <div className="rounded-xl bg-card p-3 text-center">
          <p className="text-lg font-bold text-primary">{movieCount?.value || 0}</p>
          <p className="text-[10px] text-muted-foreground">Movies</p>
        </div>
        <div className="rounded-xl bg-card p-3 text-center">
          <p className="text-lg font-bold text-primary">{watchedCount?.value || 0}</p>
          <p className="text-[10px] text-muted-foreground">Eps</p>
        </div>
        <div className="rounded-xl bg-card p-3 text-center">
          <p className="text-lg font-bold text-primary">{hoursWatched}</p>
          <p className="text-[10px] text-muted-foreground">Hours</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mb-6 grid grid-cols-2 gap-3">
        <Link
          href="/shows"
          className="flex items-center gap-3 rounded-xl bg-card p-4 text-white transition-colors hover:bg-secondary"
        >
          <Tv className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">My Shows</span>
        </Link>
        <Link
          href="/movies"
          className="flex items-center gap-3 rounded-xl bg-card p-4 text-white transition-colors hover:bg-secondary"
        >
          <Film className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">My Movies</span>
        </Link>
        <Link
          href="/import"
          className="flex items-center gap-3 rounded-xl bg-card p-4 text-white transition-colors hover:bg-secondary"
        >
          <Clock className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">Import Data</span>
        </Link>
        <Link
          href="/explore"
          className="flex items-center gap-3 rounded-xl bg-card p-4 text-white transition-colors hover:bg-secondary"
        >
          <Settings className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">Explore</span>
        </Link>
      </div>

      {/* Favorite Shows */}
      {favoriteShows.length > 0 && (
        <section className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Heart className="h-4 w-4 fill-red-500 text-red-500" />
              <h2 className="text-sm font-semibold text-white">Shows</h2>
            </div>
            <Link href="/shows" className="text-xs text-primary">
              See all
            </Link>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {favoriteShows.map((show) => (
              <Link
                key={show.tmdbId}
                href={`/show/${show.tmdbId}`}
                className="flex-shrink-0"
              >
                <div className="relative h-36 w-24 overflow-hidden rounded-lg bg-card">
                  {show.posterPath ? (
                    <Image
                      src={posterUrl(show.posterPath, "w185") ?? ""}
                      alt={show.title}
                      width={96}
                      height={144}
                      className="object-cover"
                      unoptimized
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

      {/* Favorite Movies */}
      {favoriteMovies.length > 0 && (
        <section className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Heart className="h-4 w-4 fill-red-500 text-red-500" />
              <h2 className="text-sm font-semibold text-white">Movies</h2>
            </div>
            <Link href="/movies" className="text-xs text-primary">
              See all
            </Link>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {favoriteMovies.map((movie) => (
              <Link
                key={movie.tmdbId}
                href={`/movie/${movie.tmdbId}`}
                className="flex-shrink-0"
              >
                <div className="relative h-36 w-24 overflow-hidden rounded-lg bg-card">
                  {movie.posterPath ? (
                    <Image
                      src={posterUrl(movie.posterPath, "w185") ?? ""}
                      alt={movie.title}
                      width={96}
                      height={144}
                      className="object-cover"
                      unoptimized
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

      {/* Lists */}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Lists</h2>
          <span className="text-xs text-muted-foreground">{lists.length}</span>
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

      {/* Logout */}
      <LogoutButton />
    </div>
  );
}
