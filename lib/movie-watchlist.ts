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

function todayYmd(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** True if release date is in the future. */
export function isUnreleased(
  releaseDate: string | null | undefined,
  todayStr = todayYmd()
): boolean {
  return releaseDate != null && releaseDate > todayStr;
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
  now: Date
): boolean {
  if (!releaseDate || releaseDate > todayStr) return false;
  const released = new Date(releaseDate + "T12:00:00");
  if (Number.isNaN(released.getTime())) return false;
  const ageDays = (now.getTime() - released.getTime()) / DAY_MS;
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
  const todayStr = todayYmd(now);

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
    const released = m.releaseDate
      ? new Date(m.releaseDate + "T12:00:00").getTime()
      : 0;
    return Math.max(added, Number.isFinite(released) ? released : 0);
  };

  watchNext.sort((a, b) => {
    const d = recencyScore(b) - recencyScore(a);
    if (d !== 0) return d;
    return (a.title || "").localeCompare(b.title || "");
  });

  watchLater.sort((a, b) => (a.title || "").localeCompare(b.title || ""));

  return { watchNext, watchLater };
}
