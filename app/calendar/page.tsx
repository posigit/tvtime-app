import { requireAuth } from "@/lib/auth";
import { loadFollowedEpisodeData } from "@/lib/calendar-data";
import { isEpisodeAired } from "@/lib/show-progress";
import { appTodayYmd, daysUntilYmd, toYmd, ymdAddDays } from "@/lib/app-time";
import {
  CalendarMonth,
  type CalendarDay,
  type CalendarEpisode,
} from "@/components/calendar-month";
import Link from "next/link";
import { ChevronLeft, CalendarDays } from "lucide-react";

export const dynamic = "force-dynamic";

function monthKey(ymd: string): string {
  return ymd.slice(0, 7); // YYYY-MM
}

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1, 12))
    .toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    .toUpperCase();
}

/**
 * Month-grid calendar — everything that aired/airs on each day for shows you
 * follow (watched included). Upcoming is the to-do list; this is the agenda.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const userId = await requireAuth();

  const today = appTodayYmd();
  const currentKey = monthKey(today);
  const key = month && /^\d{4}-\d{2}$/.test(month) ? month : currentKey;

  const [y, m] = key.split("-").map(Number);
  const monthStart = `${key}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthEnd = `${key}-${String(lastDay).padStart(2, "0")}`;

  const { following, episodesByShow, watchedByShow } =
    await loadFollowedEpisodeData(userId);

  // Episodes landing inside this month (watched history included)
  const byDay = new Map<string, CalendarEpisode[]>();
  for (const show of following) {
    const showWatched = watchedByShow.get(show.tmdbId) ?? new Set();
    for (const ep of episodesByShow.get(show.tmdbId) ?? []) {
      const ymd = toYmd(ep.airDate);
      if (!ymd || ymd < monthStart || ymd > monthEnd) continue;
      const item: CalendarEpisode = {
        tmdbId: show.tmdbId,
        showTitle: show.title,
        posterPath: show.posterPath,
        stillPath: ep.stillPath ?? null,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
        episodeTitle: ep.title,
        airDate: ymd,
        aired: isEpisodeAired(ymd),
        watched: showWatched.has(`${ep.seasonNumber}:${ep.episodeNumber}`),
        isPremiere: ep.episodeNumber === 1,
        daysUntil: daysUntilYmd(ymd) ?? 0,
      };
      const arr = byDay.get(ymd);
      if (arr) arr.push(item);
      else byDay.set(ymd, [item]);
    }
  }

  // 6-row grid starting on the Sunday of the week containing the 1st
  const firstDow = new Date(Date.UTC(y, m - 1, 1, 12)).getUTCDay(); // 0 = Sun
  const gridStart = ymdAddDays(monthStart, -firstDow);
  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const date = ymdAddDays(gridStart, i);
    days.push({
      date,
      day: Number(date.slice(8, 10)),
      inMonth: date >= monthStart && date <= monthEnd,
      episodes: (byDay.get(date) ?? []).sort((a, b) =>
        a.showTitle.localeCompare(b.showTitle)
      ),
    });
  }

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

      <div className="mt-4">
        <CalendarMonth
          monthLabel={monthLabel(key)}
          days={days}
          today={today}
          prevHref={`/calendar?month=${shiftMonth(key, -1)}`}
          nextHref={`/calendar?month=${shiftMonth(key, 1)}`}
        />
      </div>
    </div>
  );
}
