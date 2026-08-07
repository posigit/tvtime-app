/**
 * Single app calendar for air dates / release dates.
 *
 * Production hosts run in UTC; comparing with local `setHours(0,0,0,0)` made
 * episodes unlock at UTC midnight — often ~1 day early for US evenings.
 * Everything date-based should use APP_TIMEZONE (default Africa/Lagos).
 */

const DEFAULT_TZ = "Africa/Lagos";

export function getAppTimeZone(): string {
  // NEXT_PUBLIC_ so client components (show detail) match the server calendar
  return (
    process.env.NEXT_PUBLIC_APP_TIMEZONE?.trim() ||
    process.env.APP_TIMEZONE?.trim() ||
    DEFAULT_TZ
  );
}

/** YYYY-MM-DD for `now` in the app timezone. */
export function appTodayYmd(now: Date = new Date()): string {
  return ymdInTimeZone(now, getAppTimeZone());
}

/** Normalize TMDB-style date strings to YYYY-MM-DD (or null if unusable). */
export function toYmd(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const ymd = dateStr.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return ymd;
}

/**
 * Days from app-today until air/release date.
 * 0 = today, positive = future, negative = past.
 */
export function daysUntilYmd(
  dateStr: string | null | undefined,
  now: Date = new Date()
): number | null {
  const ymd = toYmd(dateStr);
  if (!ymd) return null;
  const today = appTodayYmd(now);
  return calendarDaysBetween(today, ymd);
}

/** Human label for a YYYY-MM-DD air date (e.g. "5 Aug 2026"). */
export function formatAppCalendarDate(dateStr: string): string {
  const ymd = toYmd(dateStr);
  if (!ymd) return dateStr;
  const [y, m, d] = ymd.split("-").map(Number);
  // Noon UTC avoids DST edge cases when only labeling the civil date.
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const day = date.getUTCDate();
  const month = date
    .toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })
    .toUpperCase();
  const year = date.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

/** Short en-US label (e.g. "Aug 5, 2026") for detail UIs. */
export function formatAppDateShort(dateStr: string | null | undefined): string {
  const ymd = toYmd(dateStr);
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * YYYY-MM-DD that is `days` before `ymd` (civil calendar, no TZ).
 * Used for upcoming lookback windows.
 */
export function ymdAddDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function ymdInTimeZone(date: Date, timeZone: string): string {
  // en-CA → YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Whole calendar days from `fromYmd` to `toYmd` (to - from). */
function calendarDaysBetween(fromYmd: string, toYmd: string): number {
  const [y1, m1, d1] = fromYmd.split("-").map(Number);
  const [y2, m2, d2] = toYmd.split("-").map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}
