import { auth, requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  shows,
  movies,
  userShows,
  userMovies,
  watchedEpisodes,
  userLists,
} from "@/lib/schema";
import { eq, and, sql, count, desc, gte } from "drizzle-orm";
import { posterUrl } from "@/lib/tmdb";
import Link from "next/link";
import Image from "next/image";
import { Bell, ChevronRight, Heart, Plus } from "lucide-react";
import { ProfileMenu } from "@/components/profile-menu";

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
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((item) => (
        <Link
          key={item.tmdbId}
          href={`${hrefPrefix}/${item.tmdbId}`}
          className="flex-shrink-0"
        >
          {/* 4-across on mobile: (viewport - 2rem page padding - 3 gaps) / 4 */}
          <div className="relative aspect-[2/3] w-[calc((100vw-3.5rem)/4)] overflow-hidden rounded-lg bg-card">
            {item.posterPath ? (
              <Image
                src={posterUrl(item.posterPath, "w185") ?? ""}
                alt={item.title}
                fill
                sizes="25vw"
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[#3a7bd5] p-2 text-center">
                <span className="text-xs font-medium text-white">
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

function SectionHeader({
  title,
  href,
  heart,
}: {
  title: string;
  href?: string;
  heart?: boolean;
}) {
  const inner = (
    <div className="flex items-center gap-2.5">
      {heart && (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e0202e]">
          <Heart className="h-3.5 w-3.5 fill-white text-white" />
        </span>
      )}
      <h2 className="text-xl font-bold text-white">{title}</h2>
    </div>
  );

  if (!href) {
    return <div className="mb-3">{inner}</div>;
  }
  return (
    <Link href={href} className="mb-3 flex items-center justify-between">
      {inner}
      <ChevronRight className="h-5 w-5 text-muted-foreground" />
    </Link>
  );
}

function StatCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-card p-4">
      <p className="mb-3 text-xs text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function BigNumber({ value }: { value: number }) {
  return (
    <p className="text-2xl font-bold text-white">
      {value.toLocaleString("en-US")}
    </p>
  );
}

function splitDuration(totalMinutes: number) {
  const months = Math.floor(totalMinutes / (30 * 24 * 60));
  const days = Math.floor((totalMinutes % (30 * 24 * 60)) / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  return { months, days, hours };
}

function DurationStat({ minutes }: { minutes: number }) {
  const { months, days, hours } = splitDuration(minutes);
  return (
    <div className="flex items-end justify-between text-center">
      <div>
        <p className="text-2xl font-bold text-white">{months}</p>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          months
        </p>
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{days}</p>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          days
        </p>
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{hours}</p>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          hours
        </p>
      </div>
    </div>
  );
}

export default async function ProfilePage() {
  const userId = await requireAuth();
  const session = await auth();

  // ----- stats data -----
  const [episodeCount] = await db
    .select({ value: count() })
    .from(watchedEpisodes)
    .where(eq(watchedEpisodes.userId, userId));

  const [tvRuntime] = await db
    .select({ value: sql<number>`COALESCE(SUM(${shows.episodeRuntime}), 0)` })
    .from(watchedEpisodes)
    .innerJoin(shows, eq(watchedEpisodes.showTmdbId, shows.tmdbId))
    .where(eq(watchedEpisodes.userId, userId));

  const [moviesWatched] = await db
    .select({
      value: count(),
      minutes: sql<number>`COALESCE(SUM(${movies.runtime}), 0)`,
    })
    .from(userMovies)
    .innerJoin(movies, eq(userMovies.tmdbId, movies.tmdbId))
    .where(and(eq(userMovies.userId, userId), eq(userMovies.status, "watched")));

  const [showCount] = await db
    .select({ value: count() })
    .from(userShows)
    .where(eq(userShows.userId, userId));

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [episodesThisMonth] = await db
    .select({ value: count() })
    .from(watchedEpisodes)
    .where(
      and(
        eq(watchedEpisodes.userId, userId),
        gte(watchedEpisodes.watchedAt, monthStart)
      )
    );

  // Day streak: consecutive watch days ending today (or yesterday)
  const watchDays = await db
    .select({ day: sql<string>`TO_CHAR(${watchedEpisodes.watchedAt}, 'YYYY-MM-DD')` })
    .from(watchedEpisodes)
    .where(eq(watchedEpisodes.userId, userId))
    .groupBy(sql`TO_CHAR(${watchedEpisodes.watchedAt}, 'YYYY-MM-DD')`);

  const daySet = new Set(watchDays.map((r) => r.day));
  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!daySet.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let dayStreak = 0;
  while (daySet.has(dayKey(cursor))) {
    dayStreak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  // ----- carousels -----
  const allShows = await db
    .select({
      tmdbId: shows.tmdbId,
      title: shows.title,
      posterPath: shows.posterPath,
      favorite: userShows.favorite,
    })
    .from(userShows)
    .innerJoin(shows, eq(userShows.tmdbId, shows.tmdbId))
    .where(eq(userShows.userId, userId))
    .orderBy(desc(userShows.updatedAt))
    .limit(20);

  const favoriteShows = allShows.filter((s) => s.favorite);

  const allMovies = await db
    .select({
      tmdbId: movies.tmdbId,
      title: movies.title,
      posterPath: movies.posterPath,
      favorite: userMovies.favorite,
    })
    .from(userMovies)
    .innerJoin(movies, eq(userMovies.tmdbId, movies.tmdbId))
    .where(eq(userMovies.userId, userId))
    .orderBy(desc(userMovies.updatedAt))
    .limit(20);

  const favoriteMovies = allMovies.filter((m) => m.favorite);

  const lists = await db
    .select()
    .from(userLists)
    .where(eq(userLists.userId, userId));

  const initial = session?.user?.name?.[0]?.toUpperCase() || "U";
  const name = session?.user?.name || "User";

  return (
    <div className="min-h-screen bg-black px-4 pb-24 pt-4">
      {/* Header: bell | menu (snapshot 6) */}
      <div className="mb-5 flex items-center justify-between">
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-black"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
        </button>
        <ProfileMenu />
      </div>

      {/* Avatar + name + EDIT */}
      <div className="mb-2 flex items-center gap-4">
        <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/40 to-primary/10 text-3xl font-bold text-white ring-2 ring-white/15">
          {initial}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">{name}</h1>
          <button
            type="button"
            className="mt-1.5 rounded-full border border-white/60 px-4 py-1 text-xs font-bold uppercase tracking-wide text-white"
          >
            Edit
          </button>
        </div>
      </div>

      {/* Social strip */}
      <div className="mb-6 grid grid-cols-3 divide-x divide-white/10 border-b border-white/10 pb-6 pt-2 text-center">
        <div>
          <p className="text-xl font-bold text-white">0</p>
          <p className="text-sm text-muted-foreground">following</p>
        </div>
        <div>
          <p className="text-xl font-bold text-white">0</p>
          <p className="text-sm text-muted-foreground">followers</p>
        </div>
        <div>
          <p className="text-xl font-bold text-white">0</p>
          <p className="text-sm text-muted-foreground">comments</p>
        </div>
      </div>

      {/* Stats — e1 style cards */}
      <section className="mb-7">
        <SectionHeader title="Stats" />
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Time watching TV">
            <DurationStat minutes={tvRuntime?.value || 0} />
          </StatCard>
          <StatCard label="Episodes watched">
            <BigNumber value={episodeCount?.value || 0} />
          </StatCard>
          <StatCard label="Movies watched">
            <BigNumber value={moviesWatched?.value || 0} />
          </StatCard>
          <StatCard label="Time watching movies">
            <DurationStat minutes={moviesWatched?.minutes || 0} />
          </StatCard>
          <StatCard label="Day streak">
            <div className="flex items-baseline gap-1.5">
              <p className="text-2xl font-bold text-white">{dayStreak}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {dayStreak === 1 ? "day" : "days"}
              </p>
            </div>
          </StatCard>
          <StatCard label="Shows in your list">
            <BigNumber value={showCount?.value || 0} />
          </StatCard>
          <StatCard label="Episodes this month">
            <BigNumber value={episodesThisMonth?.value || 0} />
          </StatCard>
        </div>
      </section>

      {/* Lists */}
      <section className="mb-7">
        <SectionHeader title="Lists" />
        {lists.length > 0 ? (
          <div className="space-y-2">
            {lists.map((list) => (
              <div
                key={list.id}
                className="flex items-center justify-between rounded-xl bg-card p-4"
              >
                <p className="font-medium text-white">{list.name}</p>
                <p className="text-xs text-muted-foreground">
                  {Array.isArray(list.items) ? list.items.length : 0} items
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[120px] items-center justify-center rounded-xl bg-card">
            <div className="flex flex-col items-center gap-2 text-white">
              <Plus className="h-7 w-7" strokeWidth={2.5} />
              <span className="text-xs font-bold uppercase tracking-wide">
                Create a new list
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Shows carousel */}
      <section className="mb-7">
        <SectionHeader title="Shows" href="/profile/list/shows" />
        <PosterCarousel
          items={allShows}
          hrefPrefix="/show"
          emptyLabel="No shows yet — explore to follow some"
        />
      </section>

      {/* Favorite shows */}
      <section className="mb-7">
        <SectionHeader title="Favorite shows" href="/profile/list/favorite-shows" heart />
        <PosterCarousel
          items={favoriteShows}
          hrefPrefix="/show"
          emptyLabel="No favorite shows yet"
        />
      </section>

      {/* Movies carousel */}
      <section className="mb-7">
        <SectionHeader title="Movies" href="/profile/list/movies" />
        <PosterCarousel
          items={allMovies}
          hrefPrefix="/movie"
          emptyLabel="No movies yet — add some from Explore"
        />
      </section>

      {/* Favorite movies */}
      <section className="mb-7">
        <SectionHeader title="Favorite movies" href="/profile/list/favorite-movies" heart />
        <PosterCarousel
          items={favoriteMovies}
          hrefPrefix="/movie"
          emptyLabel="No favorite movies yet"
        />
      </section>
    </div>
  );
}
