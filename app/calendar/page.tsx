import { requireAuth } from "@/lib/auth";
import { loadFollowedEpisodeData } from "@/lib/calendar-data";
import {
  computeUpcomingEpisodes,
  isEpisodeAired,
} from "@/lib/show-progress";
import { daysUntilYmd, formatAppCalendarDate, toYmd } from "@/lib/app-time";
import { UpcomingList, type UpcomingGroup } from "@/components/upcoming-list";
import Link from "next/link";
import { ChevronLeft, CalendarDays } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Calendar — every followed show's aired-this-week + upcoming episodes,
 * grouped by air date. TV Time's signature agenda view.
 */
export default async function CalendarPage() {
  const userId = await requireAuth();

  const { following, episodesByShow, watchedByShow } =
    await loadFollowedEpisodeData(userId);

  type Item = UpcomingGroup["items"][number];
  const items: Item[] = [];

  for (const show of following) {
    const showEpisodes = episodesByShow.get(show.tmdbId) ?? [];
    const showWatched = watchedByShow.get(show.tmdbId) ?? new Set();

    // 7-day scroll-back + all future episodes
    const upcoming = computeUpcomingEpisodes(showEpisodes, showWatched, 7);

    // LATEST = most recent already-aired unwatched ep for this show
    let latestKey: string | null = null;
    let latestTime = -Infinity;
    for (const ep of upcoming) {
      if (!ep.airDate || !isEpisodeAired(ep.airDate)) continue;
      const ymd = toYmd(ep.airDate) ?? "";
      const t = ymd ? Date.parse(ymd + "T12:00:00Z") : -Infinity;
      const key = `${ep.seasonNumber}:${ep.episodeNumber}`;
      if (t > latestTime) {
        latestTime = t;
        latestKey = key;
      }
    }

    for (const ep of upcoming) {
      if (!ep.airDate) continue;
      const key = `${ep.seasonNumber}:${ep.episodeNumber}`;
      items.push({
        tmdbId: show.tmdbId,
        title: show.title,
        posterPath: show.posterPath,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
        episodeTitle: ep.title,
        stillPath: ep.stillPath ?? null,
        airDate: ep.airDate,
        isPremiere: ep.episodeNumber === 1,
        isLatest: latestKey === key,
        aired: isEpisodeAired(ep.airDate),
        daysUntil: daysUntilYmd(ep.airDate) ?? 0,
      });
    }
  }

  items.sort((a, b) => {
    const ya = toYmd(a.airDate) ?? "";
    const yb = toYmd(b.airDate) ?? "";
    return ya < yb ? -1 : ya > yb ? 1 : 0;
  });

  const groupMap = new Map<string, Item[]>();
  for (const item of items.slice(0, 200)) {
    const key = toYmd(item.airDate) ?? item.airDate.slice(0, 10);
    const arr = groupMap.get(key);
    if (arr) arr.push(item);
    else groupMap.set(key, [item]);
  }

  const groups: UpcomingGroup[] = Array.from(groupMap.keys())
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => ({
      dateKey: key,
      label: formatAppCalendarDate(groupMap.get(key)![0].airDate),
      items: groupMap.get(key)!,
    }));

  return (
    <div className="min-h-dvh bg-black px-4 pb-nav-page">
      <div className="sticky top-0 z-40 -mx-4 bg-black/85 px-4 pb-2 pt-safe-float backdrop-blur">
        <div className="flex items-center justify-between">
          <Link
            href="/shows"
            aria-label="Back to shows"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="flex items-center gap-2 text-base font-black uppercase tracking-wide text-white">
            <CalendarDays className="h-4 w-4 text-primary" />
            Calendar
          </h1>
          <div className="h-9 w-9" />
        </div>
      </div>

      {groups.length > 0 ? (
        <div className="mt-4">
          <UpcomingList groups={groups} />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center pt-24 text-center">
          <CalendarDays className="mb-4 h-10 w-10 text-white/20" />
          <p className="mb-1 text-lg font-bold text-white">Nothing scheduled</p>
          <p className="mb-8 max-w-xs text-sm text-muted-foreground">
            New episodes of shows you follow will show up here by air date.
          </p>
          <Link
            href="/explore"
            className="rounded-full bg-primary px-8 py-3.5 text-sm font-black uppercase tracking-wide text-black"
          >
            Browse all shows
          </Link>
        </div>
      )}
    </div>
  );
}
