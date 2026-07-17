import { auth, requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { shows, movies, userShows, userMovies, watchedEpisodes, userLists } from "@/lib/schema";
import { eq, sql, count, desc } from "drizzle-orm";
import { posterUrl } from "@/lib/tmdb";
import Link from "next/link";
import Image from "next/image";
import { Bell, Heart, MoreHorizontal, Plus } from "lucide-react";
import { LogoutButton } from "@/components/logout-button";

function PosterCarousel({
  items,
  hrefPrefix,
  emptyLabel,
}: {
  items: { tmdbId: number; title: string; posterPath: string | null }[];
  hrefPrefix: string;
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {items.map((item) => (
        <Link
          key={item.tmdbId}
          href={`${hrefPrefix}/${item.tmdbId}`}
          className="flex-shrink-0"
        >
          <div className="relative h-36 w-24 overflow-hidden rounded-lg bg-card">
            {item.posterPath ? (
              <Image
                src={posterUrl(item.posterPath, "w185") ?? ""}
                alt={item.title}
                width={96}
                height={144}
                className="h-full w-full object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-blue-600 p-1 text-center">
                <span className="text-2xl opacity-80">📺</span>
                <span className="text-[10px] font-medium text-white/90">
                  {item.title || "No title yet"}
                </span>
              </div>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

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

  // Recent / all followed shows (main Shows row)
  const allShows = await db
    .select({
      tmdbId: shows.tmdbId,
      title: shows.title,
      posterPath: shows.posterPath,
    })
    .from(userShows)
    .innerJoin(shows, eq(userShows.tmdbId, shows.tmdbId))
    .where(eq(userShows.userId, userId))
    .orderBy(desc(userShows.updatedAt))
    .limit(20);

  // "Favorite" = most recently updated subset (no separate favorites flag yet)
  const favoriteShows = allShows.slice(0, 8);
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

  const allMovies = favoriteMovies;

  const lists = await db
    .select()
    .from(userLists)
    .where(eq(userLists.userId, userId));

  const initial = session?.user?.name?.[0]?.toUpperCase() || "U";
  const name = session?.user?.name || "User";

  return (
    <div className="min-h-screen bg-black px-4 py-4 pb-24">
      {/* Header: bell | username | menu — snapshot style */}
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-black"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold text-white">{name}</h1>
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground"
          aria-label="More"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>

      {/* Avatar + name */}
      <div className="mb-6 flex flex-col items-center">
        <div className="mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/5 text-2xl font-bold text-primary ring-2 ring-white/10">
          {initial}
        </div>
        <p className="text-sm text-muted-foreground">TV Time member</p>
      </div>

      {/* Personal stats (not social following/followers) */}
      <div className="mb-6 grid grid-cols-4 gap-2">
        <div className="rounded-xl bg-card p-3 text-center">
          <p className="text-lg font-bold text-white">{showCount?.value || 0}</p>
          <p className="text-[10px] text-muted-foreground">shows</p>
        </div>
        <div className="rounded-xl bg-card p-3 text-center">
          <p className="text-lg font-bold text-white">{movieCount?.value || 0}</p>
          <p className="text-[10px] text-muted-foreground">movies</p>
        </div>
        <div className="rounded-xl bg-card p-3 text-center">
          <p className="text-lg font-bold text-white">{watchedCount?.value || 0}</p>
          <p className="text-[10px] text-muted-foreground">episodes</p>
        </div>
        <div className="rounded-xl bg-card p-3 text-center">
          <p className="text-lg font-bold text-white">{hoursWatched}</p>
          <p className="text-[10px] text-muted-foreground">hours</p>
        </div>
      </div>

      {/* Lists */}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Lists</h2>
          <span className="text-muted-foreground">›</span>
        </div>
        {lists.length > 0 ? (
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
          </div>
        ) : (
          <div className="flex min-h-[88px] items-center justify-center rounded-xl bg-[#1c1c1e]">
            <div className="flex flex-col items-center gap-1 text-muted-foreground">
              <Plus className="h-6 w-6" />
              <span className="text-xs font-bold uppercase tracking-wide">
                Create a new list
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Shows carousel */}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Shows</h2>
          <Link href="/shows" className="text-muted-foreground">
            ›
          </Link>
        </div>
        <PosterCarousel
          items={allShows}
          hrefPrefix="/show"
          emptyLabel="No shows yet — explore to follow some"
        />
      </section>

      {/* Favorite shows */}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Heart className="h-4 w-4 fill-red-500 text-red-500" />
            <h2 className="text-base font-semibold text-white">Favorite shows</h2>
          </div>
          <Link href="/shows" className="text-muted-foreground">
            ›
          </Link>
        </div>
        <PosterCarousel
          items={favoriteShows}
          hrefPrefix="/show"
          emptyLabel="No favorite shows yet"
        />
      </section>

      {/* Movies carousel */}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Movies</h2>
          <Link href="/movies" className="text-muted-foreground">
            ›
          </Link>
        </div>
        <PosterCarousel
          items={allMovies}
          hrefPrefix="/movie"
          emptyLabel="No movies yet — add some from Explore"
        />
      </section>

      {/* Favorite movies */}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Heart className="h-4 w-4 fill-red-500 text-red-500" />
            <h2 className="text-base font-semibold text-white">Favorite movies</h2>
          </div>
          <Link href="/movies" className="text-muted-foreground">
            ›
          </Link>
        </div>
        <PosterCarousel
          items={favoriteMovies}
          hrefPrefix="/movie"
          emptyLabel="No favorite movies yet"
        />
      </section>

      <div className="mb-4 text-center">
        <Link href="/import" className="text-xs text-primary">
          Import data
        </Link>
      </div>

      <LogoutButton />
    </div>
  );
}
