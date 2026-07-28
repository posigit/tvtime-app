/** Pure helpers for profile taste / heatmap / year recap. */

export type DayCount = { day: string; count: number }; // YYYY-MM-DD

export type GenreStat = {
  name: string;
  count: number;
  avgScore: number | null; // 0–10 scale (app stores half-stars * 2, we convert)
};

export type TasteSnapshot = {
  avgShowScore: number | null; // 0–10
  avgMovieScore: number | null;
  ratedEpisodes: number;
  ratedMovies: number;
  genres: GenreStat[];
  topTitles: {
    key: string;
    href: string;
    title: string;
    posterPath: string | null;
    scoreLabel: string;
  }[];
};

export type YearRecap = {
  year: number;
  episodes: number;
  movies: number;
  tvMinutes: number;
  movieMinutes: number;
  activeDays: number;
  topShow: { title: string; posterPath: string | null; episodes: number } | null;
  topMovie: { title: string; posterPath: string | null; rating: number | null } | null;
  topGenre: string | null;
};

/** Convert internal rating (0–10 half-star scale stored as 0–10 integers, often 1–10) to display /10. */
export function toTenScale(raw: number): number {
  // App uses 1–10 (half-star * 2 style: 7 = 3.5 stars shown as ★ 3.5)
  return Math.round(raw * 10) / 10;
}

export function scoreLabel(raw: number): string {
  return `★ ${(raw / 2).toFixed(1)}`;
}

/** Build last `days` calendar keys ending today (local). */
export function lastNDayKeys(days: number, now = new Date()): string[] {
  const out: string[] = [];
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(d.getDate() - i);
    out.push(dayKey(x));
  }
  return out;
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Intensity 0–4 for heatmap cell coloring. */
export function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  const r = count / max;
  if (r <= 0.2) return 1;
  if (r <= 0.4) return 2;
  if (r <= 0.7) return 3;
  return 4;
}

/**
 * Extract genre names from stored TMDB JSON blob.
 * Supports `{ genres: [{ name }] }` shape from TMDB details.
 */
export function genresFromTmdbData(tmdbData: unknown): string[] {
  if (!tmdbData || typeof tmdbData !== "object") return [];
  const g = (tmdbData as { genres?: unknown }).genres;
  if (!Array.isArray(g)) return [];
  const names: string[] = [];
  for (const item of g) {
    if (item && typeof item === "object" && "name" in item) {
      const n = String((item as { name: unknown }).name || "").trim();
      if (n) names.push(n);
    }
  }
  return names;
}

export function aggregateGenres(
  rows: { genres: string[]; weight: number; scoreSum: number; scoreCount: number }[]
): GenreStat[] {
  const map = new Map<
    string,
    { count: number; scoreSum: number; scoreCount: number }
  >();
  for (const row of rows) {
    for (const name of row.genres) {
      const cur = map.get(name) ?? { count: 0, scoreSum: 0, scoreCount: 0 };
      cur.count += row.weight;
      cur.scoreSum += row.scoreSum;
      cur.scoreCount += row.scoreCount;
      map.set(name, cur);
    }
  }
  return [...map.entries()]
    .map(([name, v]) => ({
      name,
      count: v.count,
      avgScore:
        v.scoreCount > 0
          ? Math.round((v.scoreSum / v.scoreCount) * 10) / 10
          : null,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 8);
}

/** Longest consecutive day streak in a set of YYYY-MM-DD keys (any order). */
export function longestStreak(dayKeys: Iterable<string>): number {
  const sorted = [...new Set(dayKeys)].filter(Boolean).sort();
  if (sorted.length === 0) return 0;
  let best = 1;
  let cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + "T12:00:00");
    const next = new Date(sorted[i] + "T12:00:00");
    const diff = Math.round(
      (next.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000)
    );
    if (diff === 1) {
      cur++;
      best = Math.max(best, cur);
    } else if (diff > 1) {
      cur = 1;
    }
  }
  return best;
}

/** Current streak ending today or yesterday. */
export function currentStreak(daySet: Set<string>, now = new Date()): number {
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  if (!daySet.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (daySet.has(dayKey(cursor))) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}
