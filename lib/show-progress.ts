import {
  appTodayYmd,
  daysUntilYmd,
  toYmd,
  ymdAddDays,
} from "./app-time";

/** Days a new drop / just-followed / last-watch stays in Watch Next. */
export const WATCH_NEXT_DAYS = 14;

export type EpisodeInfo = {
  showTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDate?: string | null;
  stillPath?: string | null;
};

export type WatchedKey = `${number}:${number}`;

export function makeWatchedKey(
  seasonNumber: number,
  episodeNumber: number
): WatchedKey {
  return `${seasonNumber}:${episodeNumber}`;
}

/**
 * True if the episode has aired (or has no air date — treat as available).
 * Uses APP_TIMEZONE civil calendar, not server host midnight (UTC).
 */
export function isEpisodeAired(
  airDate: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!airDate) return true;
  const ymd = toYmd(airDate);
  if (!ymd) return true;
  return ymd <= appTodayYmd(now);
}

/** Chronological compare: negative if a before b, 0 equal, positive if a after b. */
export function compareEpisodeOrder(
  a: { seasonNumber: number; episodeNumber: number },
  b: { seasonNumber: number; episodeNumber: number }
): number {
  if (a.seasonNumber !== b.seasonNumber) {
    return a.seasonNumber - b.seasonNumber;
  }
  return a.episodeNumber - b.episodeNumber;
}

/**
 * "Real" last-watch time for Watch Next vs Haven't-watched-for-a-while.
 *
 * Bulk marks (import fill-previous, "mark previous as watched") stamp many
 * episodes with nearly identical timestamps. Those shouldn't keep a show in
 * Watch Next for two weeks. If the newest activity is a bulk cluster
 * (≥3 watches within 2s), fall back to the most recent watch *before* that
 * cluster; if none, return null → treat as inactive.
 */
export function effectiveLastWatchedAt(
  watchedAts: Array<Date | string | null | undefined>
): Date | null {
  const times = watchedAts
    .map((v) => {
      if (v == null) return null;
      const d = v instanceof Date ? v : new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    })
    .filter((d): d is Date => d != null)
    .sort((a, b) => b.getTime() - a.getTime());

  if (times.length === 0) return null;

  const newest = times[0];
  const BULK_WINDOW_MS = 2000;
  const BULK_MIN_COUNT = 3;
  const bulkCount = times.filter(
    (t) => newest.getTime() - t.getTime() <= BULK_WINDOW_MS
  ).length;

  if (bulkCount >= BULK_MIN_COUNT) {
    const older = times.find(
      (t) => newest.getTime() - t.getTime() > BULK_WINDOW_MS
    );
    return older ?? null;
  }

  return newest;
}

export function computeNextEpisode(
  episodes: EpisodeInfo[],
  lastWatched: { seasonNumber: number | null; episodeNumber: number | null },
  watchedKeys: Set<WatchedKey>,
  now: Date = new Date()
): { nextEpisode: EpisodeInfo | null; remaining: number } {
  const sorted = [...episodes].sort((a, b) => {
    if (a.seasonNumber !== b.seasonNumber)
      return a.seasonNumber - b.seasonNumber;
    return a.episodeNumber - b.episodeNumber;
  });

  let nextEpisode: EpisodeInfo | null = null;
  let remaining = 0;

  for (const ep of sorted) {
    if (watchedKeys.has(makeWatchedKey(ep.seasonNumber, ep.episodeNumber)))
      continue;
    if (!isEpisodeAired(ep.airDate, now)) continue;

    remaining++;

    if (!nextEpisode) {
      const isAfterLastWatched =
        !lastWatched.seasonNumber ||
        !lastWatched.episodeNumber ||
        ep.seasonNumber > lastWatched.seasonNumber ||
        (ep.seasonNumber === lastWatched.seasonNumber &&
          ep.episodeNumber > lastWatched.episodeNumber);
      if (isAfterLastWatched) {
        nextEpisode = ep;
      }
    }
  }

  if (!nextEpisode && remaining > 0) {
    nextEpisode = sorted.find(
      (ep) =>
        !watchedKeys.has(makeWatchedKey(ep.seasonNumber, ep.episodeNumber)) &&
        isEpisodeAired(ep.airDate, now)
    )!;
  }

  return { nextEpisode, remaining };
}

/** True when the next unwatched ep aired within the last `days` (today counts). */
export function isFreshEpisodeDrop(
  airDate: string | null | undefined,
  now: Date = new Date(),
  days = WATCH_NEXT_DAYS
): boolean {
  const delta = daysUntilYmd(airDate, now);
  if (delta == null) return false;
  return delta <= 0 && delta >= -days;
}

/** Watch Next vs Haven't-watched. Fresh premieres count even if last watch/follow was months ago. */
export function belongsInWatchNext(opts: {
  status: string;
  followedAt: Date | null | undefined;
  lastActivityAt: Date | null | undefined;
  hasWatches: boolean;
  nextAirDate: string | null | undefined;
  now?: Date;
}): boolean {
  if (opts.status === "for_later") return false;
  const now = opts.now ?? new Date();
  const cutoff = now.getTime() - WATCH_NEXT_DAYS * 24 * 60 * 60 * 1000;
  const isRecent =
    opts.lastActivityAt != null && opts.lastActivityAt.getTime() > cutoff;
  const isNewlyFollowed =
    opts.followedAt != null &&
    opts.followedAt.getTime() > cutoff &&
    !opts.hasWatches;
  return (
    isRecent || isNewlyFollowed || isFreshEpisodeDrop(opts.nextAirDate, now)
  );
}

export function computeUpcomingEpisodes(
  episodes: EpisodeInfo[],
  watchedKeys: Set<WatchedKey>,
  /** Days of already-aired unwatched to keep above "today" for scroll-back */
  lookbackDays = 30,
  now: Date = new Date()
): EpisodeInfo[] {
  const today = appTodayYmd(now);
  const lookback = ymdAddDays(today, -lookbackDays);

  return episodes
    .filter((ep) => {
      if (watchedKeys.has(makeWatchedKey(ep.seasonNumber, ep.episodeNumber)))
        return false;
      const ymd = toYmd(ep.airDate);
      if (!ymd) return false;
      // Recently aired (scroll up) + today + future (scroll down)
      return ymd >= lookback;
    })
    .sort((a, b) => {
      const ya = toYmd(a.airDate) ?? "";
      const yb = toYmd(b.airDate) ?? "";
      return ya < yb ? -1 : ya > yb ? 1 : 0;
    });
}
