/**
 * Split unwatched movies into Watch Next vs Watch Later.
 *
 * Watch Next:
 *  - Recently released (released within the last 90 days, already out)
 *  - Or recently *manually* added (updatedAt within 30 days, not a bulk import cluster)
 *
 * Watch Later:
 *  - Everything else unwatched (bulk import backlog, added > 30 days ago, etc.)
 */

import { appTodayYmd, toYmd, daysUntilYmd } from "./app-time";

export type MovieListRow = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  releaseDate: string | null;
  status: string;
  updatedAt: Date | string | null;
  rating?: number | null;
  watchedAt?: Date | string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_ADD_MS = 30 * DAY_MS;
const RECENT_RELEASE_DAYS = 90;
/** Movies stamped within this window of each other count as one bulk import. */
const BULK_WINDOW_MS = 5 * 60 * 1000;
/** At least this many rows in a window → treat as bulk (not manual adds). */
const BULK_MIN_COUNT = 8;

function asDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** True if release date is in the future (app timezone calendar). */
export function isUnreleased(
  releaseDate: string | null | undefined,
  todayStr = appTodayYmd()
): boolean {
  const ymd = toYmd(releaseDate);
  return ymd != null && ymd > todayStr;
}

/**
 * Mark updatedAt timestamps that belong to a bulk import cluster.
 * Returns a Set of tmdbIds that were bulk-added.
 */
export function findBulkAddedMovieIds(rows: MovieListRow[]): Set<number> {
  const withTime = rows
    .map((r) => ({ id: r.tmdbId, t: asDate(r.updatedAt)?.getTime() ?? 0 }))
    .filter((r) => r.t > 0)
    .sort((a, b) => a.t - b.t);

  const bulk = new Set<number>();
  let i = 0;
  while (i < withTime.length) {
    let j = i;
    while (
      j + 1 < withTime.length &&
      withTime[j + 1].t - withTime[i].t <= BULK_WINDOW_MS
    ) {
      j++;
    }
    const count = j - i + 1;
    if (count >= BULK_MIN_COUNT) {
      for (let k = i; k <= j; k++) bulk.add(withTime[k].id);
    }
    i = j + 1;
  }
  return bulk;
}

function isRecentlyReleased(
  releaseDate: string | null,
  todayStr: string,
  _now: Date
): boolean {
  const ymd = toYmd(releaseDate);
  if (!ymd || ymd > todayStr) return false;
  const daysSince = daysUntilYmd(ymd, _now);
  if (daysSince == null) return false;
  // daysUntil is negative when release is in the past
  const ageDays = -daysSince;
  return ageDays >= 0 && ageDays <= RECENT_RELEASE_DAYS;
}

function isRecentlyManualAdd(
  row: MovieListRow,
  bulkIds: Set<number>,
  now: Date
): boolean {
  if (bulkIds.has(row.tmdbId)) return false;
  // Intentional "for later" is not Watch Next via add-time
  if (row.status === "for_later") return false;
  const added = asDate(row.updatedAt);
  if (!added) return false;
  return now.getTime() - added.getTime() <= RECENT_ADD_MS;
}

export function splitWatchNextAndLater<T extends MovieListRow>(
  wantToWatchReleased: T[],
  now = new Date()
): { watchNext: T[]; watchLater: T[] } {
  const bulkIds = findBulkAddedMovieIds(wantToWatchReleased);
  const todayStr = appTodayYmd(now);

  const watchNext: T[] = [];
  const watchLater: T[] = [];

  for (const m of wantToWatchReleased) {
    const next =
      isRecentlyReleased(m.releaseDate, todayStr, now) ||
      isRecentlyManualAdd(m, bulkIds, now);
    if (next) watchNext.push(m);
    else watchLater.push(m);
  }

  const recencyScore = (m: T): number => {
    const added = asDate(m.updatedAt)?.getTime() ?? 0;
    const ymd = toYmd(m.releaseDate);
    // Civil date as ms for sort only (UTC noon of that day)
    const released = ymd
      ? Date.UTC(
          Number(ymd.slice(0, 4)),
          Number(ymd.slice(5, 7)) - 1,
          Number(ymd.slice(8, 10)),
          12
        )
      : 0;
    return Math.max(added, released);
  };

  watchNext.sort((a, b) => {
    const d = recencyScore(b) - recencyScore(a);
    if (d !== 0) return d;
    return (a.title || "").localeCompare(b.title || "");
  });

  watchLater.sort((a, b) => (a.title || "").localeCompare(b.title || ""));

  return { watchNext, watchLater };
}
