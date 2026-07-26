import type { CSSProperties } from "react";
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
import { eq, and, sql, count, desc, gte, isNotNull, inArray } from "drizzle-orm";
import { posterUrl, backdropUrl } from "@/lib/tmdb";
import { cn } from "@/lib/utils";
import Link from "next/link";
import Image from "next/image";
import { ChevronRight, Flame, Heart, Plus } from "lucide-react";
import { ProfileMenu } from "@/components/profile-menu";

// ---------- shared bits ----------

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

function splitDuration(totalMinutes: number) {
  const months = Math.floor(totalMinutes / (30 * 24 * 60));
  const days = Math.floor((totalMinutes % (30 * 24 * 60)) / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  return { months, days, hours };
}

// ---------- header ----------

function StatCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function BigVal({ value }: { value: number }) {
  return (
    <p className="text-xl font-bold text-white">
      {value.toLocaleString("en-US")}
    </p>
  );
}

function DurationCompact({ minutes }: { minutes: number }) {
  const { months, days, hours } = splitDuration(minutes);
  return (
    <p className="text-xl font-bold text-white">
      {months > 0 && (
        <>
          {months}
          <span className="text-[11px] font-semibold text-muted-foreground">
            mo{" "}
          </span>
        </>
      )}
      {days}
      <span className="text-[11px] font-semibold text-muted-foreground">d </span>
      {hours}
      <span className="text-[11px] font-semibold text-muted-foreground">h</span>
    </p>
  );
}

// ---------- rails ----------

/**
 * 4-across poster size. Fixed rem sizes (not Tailwind arbitrary calc / 100vw)
 * so flex children always get a real box — collapsed width was zeroing
 * aspect-ratio height and hiding every poster on Recently watched / Top rated.
 * ~84×126 ≈ 4 columns on a 390px phone with page padding + gaps.
 */
const TILE_STYLE: CSSProperties = {
  width: "5.25rem",
  minWidth: "5.25rem",
};

const POSTER_STYLE: CSSProperties = {
  ...TILE_STYLE,
  height: "7.875rem",
  minHeight: "7.875rem",
};

function PosterTile({
  title,
  posterPath,
}: {
  title: string;
  posterPath: string | null;
}) {
  const src = posterPath ? posterUrl(posterPath, "w185") : null;
  return (
    <div
      className="relative overflow-hidden rounded-lg bg-[#2c2c2e]"
      style={POSTER_STYLE}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- plain img always paints; next/image fill was collapsing
        <img
          src={src}
          alt={title}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[#3a7bd5] p-2 text-center">
          <span className="text-xs font-medium text-white">
            {title || "No title yet"}
          </span>
        </div>
      )}
    </div>
  );
}

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
          className="block shrink-0"
        >
          <PosterTile title={item.title} posterPath={item.posterPath} />
        </Link>
      ))}
    </div>
  );
}

type RailItem = {
  key: string;
  href: string;
  title: string;
  posterPath: string | null;
  sub: string;
  subAccent?: boolean;
};

/** Poster rail with a title + caption under each tile (Recently Watched / Top Rated). */
function CaptionedRail({ items }: { items: RailItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((item) => (
        <Link key={item.key} href={item.href} className="block shrink-0">
          <PosterTile title={item.title} posterPath={item.posterPath} />
          <div style={TILE_STYLE}>
            <p className="mt-1.5 truncate text-xs font-semibold text-white">
              {item.title}
            </p>
            <p
              className={cn(
                "truncate text-[10px] font-medium",
                item.subAccent ? "text-primary" : "text-muted-foreground"
              )}
            >
              {item.sub}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ---------- page ----------

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

  const [movieTotal] = await db
    .select({ value: count() })
    .from(userMovies)
    .where(eq(userMovies.userId, userId));

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

  // ----- identity -----
  // "Watching since" = earliest watch activity in your data (import included),
  // not the app account creation date (which is often the install year).
  const [[firstEp], [firstMovie]] = await Promise.all([
    db
      .select({
        first: sql<string | Date | null>`MIN(${watchedEpisodes.watchedAt})`,
      })
      .from(watchedEpisodes)
      .where(
        and(
          eq(watchedEpisodes.userId, userId),
          isNotNull(watchedEpisodes.watchedAt)
        )
      ),
    db
      .select({
        first: sql<string | Date | null>`MIN(${userMovies.watchedAt})`,
      })
      .from(userMovies)
      .where(
        and(eq(userMovies.userId, userId), isNotNull(userMovies.watchedAt))
      ),
  ]);

  const parseActivityDate = (v: string | Date | null | undefined): Date | null => {
    if (v == null) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const epDate = parseActivityDate(firstEp?.first);
  const mvDate = parseActivityDate(firstMovie?.first);
  const sinceDate =
    epDate && mvDate
      ? epDate < mvDate
        ? epDate
        : mvDate
      : (epDate ?? mvDate);

  const since = sinceDate
    ? sinceDate.toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      })
    : null;

  // ----- recently watched (episodes + movies, merged by recency) -----
  const [recentEpisodes, recentMovies] = await Promise.all([
    db
      .select({
        tmdbId: shows.tmdbId,
        title: shows.title,
        posterPath: shows.posterPath,
        backdropPath: shows.backdropPath,
        seasonNumber: watchedEpisodes.seasonNumber,
        episodeNumber: watchedEpisodes.episodeNumber,
        watchedAt: watchedEpisodes.watchedAt,
      })
      .from(watchedEpisodes)
      .innerJoin(shows, eq(watchedEpisodes.showTmdbId, shows.tmdbId))
      .where(
        and(
          eq(watchedEpisodes.userId, userId),
          isNotNull(watchedEpisodes.watchedAt)
        )
      )
      .orderBy(desc(watchedEpisodes.watchedAt))
      // Extra rows so dedupe-by-show still fills ≥4 tiles
      .limit(40),
    db
      .select({
        tmdbId: movies.tmdbId,
        title: movies.title,
        posterPath: movies.posterPath,
        backdropPath: movies.backdropPath,
        rating: userMovies.rating,
        watchedAt: userMovies.watchedAt,
      })
      .from(userMovies)
      .innerJoin(movies, eq(userMovies.tmdbId, movies.tmdbId))
      .where(
        and(
          eq(userMovies.userId, userId),
          eq(userMovies.status, "watched"),
          isNotNull(userMovies.watchedAt)
        )
      )
      .orderBy(desc(userMovies.watchedAt))
      .limit(20),
  ]);

  // One tile per show/movie (latest watch wins) so the rail shows distinct posters.
  type RecentRaw = {
    key: string;
    href: string;
    title: string;
    posterPath: string | null;
    backdropPath: string | null;
    sub: string;
    subAccent: boolean;
    watchedAt: Date | null;
  };
  const recentCandidates: RecentRaw[] = [
    ...recentEpisodes.map((e) => ({
      key: `show-${e.tmdbId}`,
      href: `/show/${e.tmdbId}`,
      title: e.title,
      posterPath: e.posterPath,
      backdropPath: e.backdropPath,
      sub: `S${String(e.seasonNumber).padStart(2, "0")} E${String(e.episodeNumber).padStart(2, "0")}`,
      subAccent: false,
      watchedAt: e.watchedAt,
    })),
    ...recentMovies.map((m) => ({
      key: `mv-${m.tmdbId}`,
      href: `/movie/${m.tmdbId}`,
      title: m.title,
      posterPath: m.posterPath,
      backdropPath: m.backdropPath,
      sub: m.rating != null ? `★ ${(m.rating / 2).toFixed(1)}` : "Movie",
      subAccent: m.rating != null,
      watchedAt: m.watchedAt,
    })),
  ].sort(
    (a, b) => (b.watchedAt?.getTime() ?? 0) - (a.watchedAt?.getTime() ?? 0)
  );

  const seenRecent = new Set<string>();
  const recentDeduped: RecentRaw[] = [];
  for (const item of recentCandidates) {
    if (seenRecent.has(item.key)) continue;
    seenRecent.add(item.key);
    recentDeduped.push(item);
    if (recentDeduped.length >= 12) break;
  }

  const recentItems: RailItem[] = recentDeduped.map(
    ({ backdropPath: _b, watchedAt: _w, ...item }) => item
  );
  const bannerBackdrop = recentDeduped[0]?.backdropPath ?? null;

  // ----- top rated (movies + shows via derived episode-rating score) -----
  const [topMovies, topShows] = await Promise.all([
    db
      .select({
        tmdbId: movies.tmdbId,
        title: movies.title,
        posterPath: movies.posterPath,
        rating: userMovies.rating,
      })
      .from(userMovies)
      .innerJoin(movies, eq(userMovies.tmdbId, movies.tmdbId))
      .where(and(eq(userMovies.userId, userId), isNotNull(userMovies.rating)))
      .orderBy(desc(userMovies.rating))
      .limit(12),
    db
      .select({
        tmdbId: shows.tmdbId,
        title: shows.title,
        posterPath: shows.posterPath,
        avgScore: sql<number>`AVG(${watchedEpisodes.rating})::float`,
        ratedCount: count(),
      })
      .from(watchedEpisodes)
      .innerJoin(shows, eq(watchedEpisodes.showTmdbId, shows.tmdbId))
      .where(
        and(
          eq(watchedEpisodes.userId, userId),
          isNotNull(watchedEpisodes.rating)
        )
      )
      .groupBy(shows.tmdbId, shows.title, shows.posterPath)
      .orderBy(desc(sql`AVG(${watchedEpisodes.rating})`))
      .limit(12),
  ]);

  const topRatedItems: RailItem[] = [
    ...topMovies.map((m) => ({
      key: `tm-${m.tmdbId}`,
      href: `/movie/${m.tmdbId}`,
      title: m.title,
      posterPath: m.posterPath,
      score: m.rating ?? 0,
      sub: `★ ${((m.rating ?? 0) / 2).toFixed(1)}`,
    })),
    ...topShows.map((s) => ({
      key: `ts-${s.tmdbId}`,
      href: `/show/${s.tmdbId}`,
      title: s.title,
      posterPath: s.posterPath,
      score: s.avgScore,
      sub: `★ ${(s.avgScore / 2).toFixed(1)} · ${s.ratedCount} ep${s.ratedCount === 1 ? "" : "s"}`,
    })),
  ]
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(({ score: _s, ...item }) => ({ ...item, subAccent: true }));

  // ----- library carousels -----
  // Favorites must be their own queries. Filtering favorites out of a
  // limit(20) "recently updated" slice leaves the rails empty whenever
  // favorites aren't among the 20 most-recently-touched library rows.
  const [allShows, favoriteShows, allMovies, favoriteMovies, lists] =
    await Promise.all([
      db
        .select({
          tmdbId: shows.tmdbId,
          title: shows.title,
          posterPath: shows.posterPath,
        })
        .from(userShows)
        .innerJoin(shows, eq(userShows.tmdbId, shows.tmdbId))
        .where(eq(userShows.userId, userId))
        .orderBy(desc(userShows.updatedAt))
        .limit(20),
      db
        .select({
          tmdbId: shows.tmdbId,
          title: shows.title,
          posterPath: shows.posterPath,
        })
        .from(userShows)
        .innerJoin(shows, eq(userShows.tmdbId, shows.tmdbId))
        .where(and(eq(userShows.userId, userId), eq(userShows.favorite, true)))
        .orderBy(desc(userShows.updatedAt))
        .limit(20),
      db
        .select({
          tmdbId: movies.tmdbId,
          title: movies.title,
          posterPath: movies.posterPath,
        })
        .from(userMovies)
        .innerJoin(movies, eq(userMovies.tmdbId, movies.tmdbId))
        .where(eq(userMovies.userId, userId))
        .orderBy(desc(userMovies.updatedAt))
        .limit(20),
      db
        .select({
          tmdbId: movies.tmdbId,
          title: movies.title,
          posterPath: movies.posterPath,
        })
        .from(userMovies)
        .innerJoin(movies, eq(userMovies.tmdbId, movies.tmdbId))
        .where(
          and(eq(userMovies.userId, userId), eq(userMovies.favorite, true))
        )
        .orderBy(desc(userMovies.updatedAt))
        .limit(20),
      db.select().from(userLists).where(eq(userLists.userId, userId)),
    ]);

  // Resolve up to 4 poster previews per list so the Lists section isn't blank text.
  type ListItemRef = { tmdbId?: number; type?: string };
  const listPreviewIds = {
    movie: new Set<number>(),
    tv: new Set<number>(),
  };
  for (const list of lists) {
    const items = (Array.isArray(list.items) ? list.items : []) as ListItemRef[];
    for (const item of items.slice(0, 4)) {
      if (!Number.isFinite(item?.tmdbId)) continue;
      if (item.type === "movie" || list.type === "favorite_movies") {
        listPreviewIds.movie.add(item.tmdbId!);
      } else {
        listPreviewIds.tv.add(item.tmdbId!);
      }
    }
  }

  const moviePreviewIds = [...listPreviewIds.movie];
  const showPreviewIds = [...listPreviewIds.tv];
  const [listMoviePosters, listShowPosters] = await Promise.all([
    moviePreviewIds.length > 0
      ? db
          .select({ tmdbId: movies.tmdbId, posterPath: movies.posterPath })
          .from(movies)
          .where(inArray(movies.tmdbId, moviePreviewIds))
      : Promise.resolve([] as { tmdbId: number; posterPath: string | null }[]),
    showPreviewIds.length > 0
      ? db
          .select({ tmdbId: shows.tmdbId, posterPath: shows.posterPath })
          .from(shows)
          .where(inArray(shows.tmdbId, showPreviewIds))
      : Promise.resolve([] as { tmdbId: number; posterPath: string | null }[]),
  ]);

  const posterByMovie = new Map(
    listMoviePosters.map((m) => [m.tmdbId, m.posterPath])
  );
  const posterByShow = new Map(
    listShowPosters.map((s) => [s.tmdbId, s.posterPath])
  );

  const listHref = (type: string) => {
    if (type === "favorite_movies") return "/profile/list/favorite-movies";
    if (type === "favorite_shows") return "/profile/list/favorite-shows";
    return null;
  };

  const listsWithPreviews = lists.map((list) => {
    const items = (Array.isArray(list.items) ? list.items : []) as ListItemRef[];
    const previews = items.slice(0, 4).map((item) => {
      const id = Number(item?.tmdbId);
      if (!Number.isFinite(id)) return null;
      const isMovie =
        item.type === "movie" || list.type === "favorite_movies";
      return isMovie
        ? (posterByMovie.get(id) ?? null)
        : (posterByShow.get(id) ?? null);
    });
    return {
      id: list.id,
      name: list.name,
      type: list.type,
      count: items.length,
      href: listHref(list.type),
      previews,
    };
  });

  const initial = session?.user?.name?.[0]?.toUpperCase() || "U";
  const name = session?.user?.name || "User";

  return (
    <div className="min-h-screen bg-black pb-24">
      {/* ---------- Hero banner ---------- */}
      <div className="relative h-40 w-full overflow-hidden">
        {bannerBackdrop ? (
          <Image
            src={backdropUrl(bannerBackdrop, "w1280") ?? ""}
            alt=""
            fill
            sizes="100vw"
            className="object-cover"
            unoptimized
            priority
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-primary/40 via-[#1c1c1e] to-black" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/10" />
        <div className="absolute right-4 top-4">
          <ProfileMenu />
        </div>
      </div>

      <div className="px-4">
        {/* Avatar + identity (overlapping the banner) */}
        <div className="-mt-10 mb-6 flex items-end gap-4">
          <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/60 to-primary/20 text-3xl font-bold text-white ring-4 ring-black">
            {initial}
          </div>
          <div className="min-w-0 pb-1">
            <h1 className="truncate text-2xl font-bold text-white">{name}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {since ? `Watching since ${since} · ` : ""}
              {showCount?.value ?? 0} shows · {movieTotal?.value ?? 0} movies
            </p>
          </div>
        </div>

        {/* ---------- Stats (one consolidated card) ---------- */}
        <section className="mb-8">
          <SectionHeader title="Stats" />
          <div className="rounded-2xl bg-card p-4">
            <div className="grid grid-cols-2 gap-x-3 gap-y-5">
              <StatCell label="Day streak">
                <p className="flex items-center gap-1.5 text-xl font-bold text-white">
                  <Flame
                    className={cn(
                      "h-5 w-5",
                      dayStreak > 0
                        ? "text-[#f5a623]"
                        : "text-muted-foreground"
                    )}
                    fill="currentColor"
                  />
                  {dayStreak}
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {dayStreak === 1 ? "day" : "days"}
                  </span>
                </p>
              </StatCell>
              <StatCell label="Episodes this month">
                <BigVal value={episodesThisMonth?.value || 0} />
              </StatCell>
              <StatCell label="Time watching TV">
                <DurationCompact minutes={tvRuntime?.value || 0} />
              </StatCell>
              <StatCell label="Episodes watched">
                <BigVal value={episodeCount?.value || 0} />
              </StatCell>
              <StatCell label="Time watching movies">
                <DurationCompact minutes={moviesWatched?.minutes || 0} />
              </StatCell>
              <StatCell label="Movies watched">
                <BigVal value={moviesWatched?.value || 0} />
              </StatCell>
            </div>
          </div>
        </section>

        {/* ---------- Recently watched ---------- */}
        {recentItems.length > 0 && (
          <section className="mb-8">
            <SectionHeader title="Recently watched" />
            <CaptionedRail items={recentItems} />
          </section>
        )}

        {/* ---------- Top rated ---------- */}
        {topRatedItems.length > 0 && (
          <section className="mb-8">
            <SectionHeader title="Top rated" />
            <CaptionedRail items={topRatedItems} />
          </section>
        )}

        {/* ---------- Lists ---------- */}
        <section className="mb-8">
          <SectionHeader title="Lists" />
          {listsWithPreviews.length > 0 ? (
            <div className="space-y-2">
              {listsWithPreviews.map((list) => {
                const body = (
                  <>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="font-medium text-white">{list.name}</p>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <span className="text-xs">
                          {list.count} item{list.count === 1 ? "" : "s"}
                        </span>
                        {list.href && <ChevronRight className="h-4 w-4" />}
                      </div>
                    </div>
                    {list.previews.some(Boolean) ? (
                      <div className="flex gap-1.5">
                        {list.previews.map((path, i) => {
                          const src = path ? posterUrl(path, "w92") : null;
                          return (
                            <div
                              key={i}
                              className="relative h-[4.5rem] w-12 shrink-0 overflow-hidden rounded-md bg-[#2c2c2e]"
                            >
                              {src ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={src}
                                  alt=""
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                />
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </>
                );

                return list.href ? (
                  <Link
                    key={list.id}
                    href={list.href}
                    className="block rounded-xl bg-card p-4"
                  >
                    {body}
                  </Link>
                ) : (
                  <div key={list.id} className="rounded-xl bg-card p-4">
                    {body}
                  </div>
                );
              })}
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

        {/* ---------- Library rails ---------- */}
        <section className="mb-8">
          <SectionHeader title="Shows" href="/profile/list/shows" />
          <PosterCarousel
            items={allShows}
            hrefPrefix="/show"
            emptyLabel="No shows yet — explore to follow some"
          />
        </section>

        <section className="mb-8">
          <SectionHeader
            title="Favorite shows"
            href="/profile/list/favorite-shows"
            heart
          />
          <PosterCarousel
            items={favoriteShows}
            hrefPrefix="/show"
            emptyLabel="No favorite shows yet"
          />
        </section>

        <section className="mb-8">
          <SectionHeader title="Movies" href="/profile/list/movies" />
          <PosterCarousel
            items={allMovies}
            hrefPrefix="/movie"
            emptyLabel="No movies yet — add some from Explore"
          />
        </section>

        <section className="mb-8">
          <SectionHeader
            title="Favorite movies"
            href="/profile/list/favorite-movies"
            heart
          />
          <PosterCarousel
            items={favoriteMovies}
            hrefPrefix="/movie"
            emptyLabel="No favorite movies yet"
          />
        </section>
      </div>
    </div>
  );
}
