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

function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/** True if the episode has aired (or has no air date — treat as available). */
export function isEpisodeAired(airDate: string | null | undefined): boolean {
  if (!airDate) return true;
  const d = new Date(airDate.includes("T") ? airDate : airDate + "T12:00:00");
  d.setHours(0, 0, 0, 0);
  return d <= startOfToday();
}

function isAired(airDate: string | null | undefined, today: Date): boolean {
  if (!airDate) return true;
  const d = new Date(airDate.includes("T") ? airDate : airDate + "T12:00:00");
  d.setHours(0, 0, 0, 0);
  return d <= today;
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
  watchedKeys: Set<WatchedKey>
): { nextEpisode: EpisodeInfo | null; remaining: number } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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
    if (!isAired(ep.airDate, today)) continue;

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
        isAired(ep.airDate, today)
    )!;
  }

  return { nextEpisode, remaining };
}

export function computeUpcomingEpisodes(
  episodes: EpisodeInfo[],
  watchedKeys: Set<WatchedKey>,
  /** Days of already-aired unwatched to keep above "today" for scroll-back */
  lookbackDays = 30
): EpisodeInfo[] {
  const today = startOfToday();
  const lookback = new Date(today);
  lookback.setDate(lookback.getDate() - lookbackDays);

  return episodes
    .filter((ep) => {
      if (watchedKeys.has(makeWatchedKey(ep.seasonNumber, ep.episodeNumber)))
        return false;
      if (!ep.airDate) return false;
      const d = new Date(ep.airDate.includes("T") ? ep.airDate : ep.airDate + "T12:00:00");
      d.setHours(0, 0, 0, 0);
      // Recently aired (scroll up) + today + future (scroll down)
      return d >= lookback;
    })
    .sort(
      (a, b) =>
        new Date(a.airDate!).getTime() - new Date(b.airDate!).getTime()
    );
}
