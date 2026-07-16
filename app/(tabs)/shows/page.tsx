import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  shows,
  userShows,
  watchedEpisodes,
} from "@/lib/schema";
import { eq, and, inArray } from "drizzle-orm";
import { ShowTabs } from "@/components/show-tabs";
import { SectionLabel } from "@/components/section-label";
import { ShowListItem, ShowListItemData } from "@/components/show-list-item";
import {
  computeNextEpisode,
  computeUpcomingEpisodes,
  makeWatchedKey,
  EpisodeInfo,
  WatchedKey,
} from "@/lib/show-progress";
import { ensureEpisodes } from "@/lib/ensure";
import { posterUrl } from "@/lib/tmdb";
import Link from "next/link";
import Image from "next/image";

export default async function ShowsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const currentView = view === "upcoming" ? "upcoming" : "watchlist";

  const userId = await requireAuth();

  const userShowsList = await db
    .select({
      tmdbId: shows.tmdbId,
      title: shows.title,
      posterPath: shows.posterPath,
      status: userShows.status,
      lastSeason: userShows.lastSeason,
      lastEpisode: userShows.lastEpisode,
      lastWatchedAt: userShows.lastWatchedAt,
      numberOfSeasons: shows.numberOfSeasons,
    })
    .from(userShows)
    .innerJoin(shows, eq(userShows.tmdbId, shows.tmdbId))
    .where(eq(userShows.userId, userId));

  const watching = userShowsList.filter(
    (s) => s.status === "watching" || s.status === "for_later"
  );

  const watchingIds = watching.map((s) => s.tmdbId);

  // Ensure episodes exist for all watching shows (fetch from TMDB if missing)
  let allEpisodes: EpisodeInfo[] = [];
  let watchedByShow = new Map<number, Set<WatchedKey>>();

  if (watching.length > 0) {
    const [episodesByShowResults, watched] = await Promise.all([
      Promise.all(
        watching.map((show) => ensureEpisodes(show.tmdbId, show.numberOfSeasons))
      ),
      watchingIds.length > 0
        ? db
            .select({
              showTmdbId: watchedEpisodes.showTmdbId,
              seasonNumber: watchedEpisodes.seasonNumber,
              episodeNumber: watchedEpisodes.episodeNumber,
            })
            .from(watchedEpisodes)
            .where(
              and(
                eq(watchedEpisodes.userId, userId),
                inArray(watchedEpisodes.showTmdbId, watchingIds)
              )
            )
        : Promise.resolve([]),
    ]);

    allEpisodes = episodesByShowResults.flat();

    for (const w of watched) {
      let set = watchedByShow.get(w.showTmdbId);
      if (!set) {
        set = new Set();
        watchedByShow.set(w.showTmdbId, set);
      }
      set.add(makeWatchedKey(w.seasonNumber, w.episodeNumber));
    }
  }

  const episodesByShow = new Map<number, EpisodeInfo[]>();
  for (const ep of allEpisodes) {
    let arr = episodesByShow.get(ep.showTmdbId);
    if (!arr) {
      arr = [];
      episodesByShow.set(ep.showTmdbId, arr);
    }
    arr.push(ep);
  }

  // WATCH LIST VIEW
  let watchNext: ShowListItemData[] = [];
  let haventWatched: ShowListItemData[] = [];

  if (currentView === "watchlist") {
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    for (const show of watching) {
      const showEpisodes = episodesByShow.get(show.tmdbId) ?? [];
      const showWatched = watchedByShow.get(show.tmdbId) ?? new Set();

      const { nextEpisode, remaining } = computeNextEpisode(
        showEpisodes,
        { seasonNumber: show.lastSeason, episodeNumber: show.lastEpisode },
        showWatched
      );

      const item: ShowListItemData = {
        tmdbId: show.tmdbId,
        title: show.title,
        posterPath: show.posterPath,
        nextEpisode: nextEpisode
          ? {
              seasonNumber: nextEpisode.seasonNumber,
              episodeNumber: nextEpisode.episodeNumber,
              title: nextEpisode.title,
            }
          : null,
        remaining,
      };

      if (show.lastWatchedAt && show.lastWatchedAt > twoWeeksAgo) {
        watchNext.push(item);
      } else {
        haventWatched.push(item);
      }
    }

    watchNext.sort(
      (a, b) =>
        (watching.find((s) => s.tmdbId === b.tmdbId)?.lastWatchedAt?.getTime() ??
          0) -
        (watching.find((s) => s.tmdbId === a.tmdbId)?.lastWatchedAt?.getTime() ??
          0)
    );
    haventWatched.sort(
      (a, b) =>
        (watching.find((s) => s.tmdbId === a.tmdbId)?.lastWatchedAt?.getTime() ??
          0) -
        (watching.find((s) => s.tmdbId === b.tmdbId)?.lastWatchedAt?.getTime() ??
          0)
    );
  }

  // UPCOMING VIEW
  let upcomingItems: Array<{
    tmdbId: number;
    title: string;
    posterPath: string | null;
    seasonNumber: number;
    episodeNumber: number;
    episodeTitle: string;
    airDate: string;
  }> = [];

  if (currentView === "upcoming") {
    for (const show of watching) {
      const showEpisodes = episodesByShow.get(show.tmdbId) ?? [];
      const showWatched = watchedByShow.get(show.tmdbId) ?? new Set();

      const upcoming = computeUpcomingEpisodes(showEpisodes, showWatched);

      for (const ep of upcoming) {
        upcomingItems.push({
          tmdbId: show.tmdbId,
          title: show.title,
          posterPath: show.posterPath,
          seasonNumber: ep.seasonNumber,
          episodeNumber: ep.episodeNumber,
          episodeTitle: ep.title,
          airDate: ep.airDate || "",
        });
      }
    }

    upcomingItems.sort(
      (a, b) =>
        new Date(b.airDate).getTime() - new Date(a.airDate).getTime()
    );
    upcomingItems = upcomingItems.slice(0, 50);
  }

  return (
    <div className="min-h-screen bg-black px-4 pb-24 pt-2">
      <div className="sticky top-0 z-10 bg-black pb-2 pt-2">
        <ShowTabs
          tabs={[
            { value: "watchlist", label: "WATCH LIST" },
            { value: "upcoming", label: "UPCOMING" },
          ]}
        />
      </div>

      {currentView === "watchlist" && (
        <>
          {watchNext.length > 0 && (
            <section className="mb-6">
              <div className="mb-3 flex justify-center">
                <SectionLabel>Watch Next</SectionLabel>
              </div>
              <div className="space-y-2">
                {watchNext.map((show) => (
                  <ShowListItem key={show.tmdbId} show={show} />
                ))}
              </div>
            </section>
          )}

          {haventWatched.length > 0 && (
            <section className="mb-6">
              <div className="mb-3 flex justify-center">
                <SectionLabel>Haven&apos;t watched for a while</SectionLabel>
              </div>
              <div className="space-y-2">
                {haventWatched.map((show) => (
                  <ShowListItem key={show.tmdbId} show={show} />
                ))}
              </div>
            </section>
          )}

          {watching.length === 0 && (
            <div className="flex flex-col items-center justify-center pt-20">
              <p className="mb-4 text-muted-foreground">
                No shows in your watch list yet
              </p>
              <Link
                href="/explore"
                className="rounded-full bg-primary px-6 py-3 text-sm font-bold text-black"
              >
                BROWSE ALL SHOWS
              </Link>
            </div>
          )}
        </>
      )}

      {currentView === "upcoming" && (
        <>
          {upcomingItems.length > 0 ? (
            <section>
              <div className="mb-3 flex justify-center">
                <SectionLabel>Recently aired</SectionLabel>
              </div>
              <div className="space-y-2">
                {upcomingItems.map((item) => (
                  <Link
                    key={`${item.tmdbId}-${item.seasonNumber}-${item.episodeNumber}`}
                    href={`/show/${item.tmdbId}`}
                    className="flex items-center gap-3 rounded-xl bg-[#111112] p-3 transition-colors hover:bg-[#1c1c1e]"
                  >
                    <div
                      className="relative flex-shrink-0 overflow-hidden rounded-lg bg-[#2c2c2e]"
                      style={{ width: 56, height: 84 }}
                    >
                      {item.posterPath ? (
                        <Image
                          src={posterUrl(item.posterPath, "w154") ?? ""}
                          alt={item.title}
                          width={56}
                          height={84}
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                          No img
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="mb-1 truncate font-bold text-white">
                        {item.title}
                      </p>
                      <p className="text-sm font-bold text-white">
                        S{String(item.seasonNumber).padStart(2, "0")} | E
                        {String(item.episodeNumber).padStart(2, "0")}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.episodeTitle}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(item.airDate).toLocaleDateString("en-US", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ) : (
            <div className="flex flex-col items-center justify-center pt-20">
              <p className="mb-4 text-muted-foreground">
                No upcoming episodes for your shows
              </p>
              <Link
                href="/explore"
                className="rounded-full bg-primary px-6 py-3 text-sm font-bold text-black"
              >
                BROWSE ALL SHOWS
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
