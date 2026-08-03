import {
  discoverGreatMovies,
  getTopRatedMoviesPage,
  type TmdbMovieCard,
} from "./tmdb";
import { db } from "./db";
import { surprisePool } from "./schema";

export type SurpriseMovie = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  releaseDate: string | null;
  runtime: number | null;
  rtScore: number | null;
  rating?: number | null;
  voteAverage?: number | null;
  badge?: string;
};

function toSurprise(card: TmdbMovieCard, badge: string): SurpriseMovie {
  return {
    tmdbId: card.id,
    title: card.title,
    posterPath: card.poster_path ?? null,
    releaseDate: card.release_date ?? null,
    runtime: null,
    rtScore: null,
    voteAverage: card.vote_average ?? null,
    badge,
  };
}

/** ISO week key, e.g. "2026-W31" — the pool is rebuilt once per week. */
export function isoWeekKey(date = new Date()): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  // Thursday of this week decides the ISO year/week
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const week1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getUTCDay() + 6) % 7)) /
        7
    );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function weekNumber(weekKey: string): number {
  const m = weekKey.match(/-W(\d+)$/);
  return m ? Number(m[1]) : 0;
}

type Slice = { badge: string; fetch: () => Promise<TmdbMovieCard[]> };

/**
 * Pool slices. Canon slices are stable; discover slices rotate pages by ISO
 * week so the pool composition changes at every weekly rebuild.
 */
function poolSlices(weekKey: string): Slice[] {
  const w = weekNumber(weekKey);
  const rot = (n: number) => 1 + (w % n); // 1-based rotating page

  const decades: Array<{ label: string; gte: number; lte: number }> = [
    { label: "60s classic", gte: 1960, lte: 1969 },
    { label: "70s classic", gte: 1970, lte: 1979 },
    { label: "80s classic", gte: 1980, lte: 1989 },
    { label: "90s classic", gte: 1990, lte: 1999 },
    { label: "2000s favorite", gte: 2000, lte: 2009 },
    { label: "2010s favorite", gte: 2010, lte: 2019 },
  ];

  const fail = () => Promise.resolve([] as TmdbMovieCard[]);
  const safe = (p: Promise<TmdbMovieCard[]>) => p.catch(fail);

  return [
    // The canon — always included
    ...[1, 2, 3, 4, 5].map((page) => ({
      badge: "Top rated",
      fetch: () => safe(getTopRatedMoviesPage(page)),
    })),
    // Critically acclaimed, rotating pages 1–4
    ...[rot(4), ((rot(4) + 1) % 4) + 1].map((page) => ({
      badge: "Critically acclaimed",
      fetch: () => safe(discoverGreatMovies(page)),
    })),
    // All-time classics, rotating
    ...[rot(4), ((rot(4) + 1) % 4) + 1].map((page) => ({
      badge: "Classic",
      fetch: () =>
        safe(discoverGreatMovies(page, { maxYear: 1999, minVoteAverage: 7.8 })),
    })),
    // Decade slices
    ...decades.map((d) => ({
      badge: d.label,
      fetch: () =>
        safe(
          discoverGreatMovies(rot(3), {
            minYear: d.gte,
            maxYear: d.lte,
            minVoteAverage: 7.5,
            minVoteCount: 400,
          })
        ),
    })),
    // Hidden gems: strong rating, low vote volume, rotating pages 1–5
    ...[rot(5), ((rot(5) + 2) % 5) + 1].map((page) => ({
      badge: "Hidden gem",
      fetch: () =>
        safe(
          discoverGreatMovies(page, {
            minVoteAverage: 7.3,
            minVoteCount: 150,
            maxVoteCount: 799,
          })
        ),
    })),
    // World cinema
    {
      badge: "World cinema",
      fetch: () =>
        safe(
          discoverGreatMovies(rot(3), {
            minVoteAverage: 7.5,
            minVoteCount: 300,
            originalLanguage: "fr|ja|ko|it|es|de",
          })
        ),
    },
  ];
}

async function fetchPoolCards(
  weekKey: string
): Promise<{ card: TmdbMovieCard; badge: string }[]> {
  const slices = poolSlices(weekKey);
  const results = await Promise.all(slices.map((s) => s.fetch()));
  return results.flatMap((cards, i) =>
    cards.map((card) => ({ card, badge: slices[i].badge }))
  );
}

function dedupeAndSort(
  tagged: { card: TmdbMovieCard; badge: string }[],
  excludeIds: Set<number>
): SurpriseMovie[] {
  const seen = new Set<number>();
  const out: SurpriseMovie[] = [];

  for (const { card, badge } of tagged) {
    if (excludeIds.has(card.id) || seen.has(card.id)) continue;
    if (!card.poster_path) continue; // skip blank tiles
    seen.add(card.id);
    out.push(toSurprise(card, badge));
  }

  // Prefer higher scores when order is later used for display; shuffle is random at pick time
  out.sort(
    (a, b) => (b.voteAverage ?? 0) - (a.voteAverage ?? 0) || a.title.localeCompare(b.title)
  );

  return out;
}

/**
 * Rebuild the surprise pool table for the current ISO week.
 * Called by the weekly cron (Thursday night) and scripts/weekly-refresh.ts.
 */
export async function rebuildSurprisePool(): Promise<{
  week: string;
  count: number;
}> {
  const week = isoWeekKey();
  const tagged = await fetchPoolCards(week);
  const pool = dedupeAndSort(tagged, new Set());

  await db.delete(surprisePool);
  if (pool.length > 0) {
    await db.insert(surprisePool).values(
      pool.map((m) => ({
        tmdbId: m.tmdbId,
        title: m.title,
        posterPath: m.posterPath,
        releaseDate: m.releaseDate,
        runtime: m.runtime,
        voteAverage: m.voteAverage,
        badge: m.badge ?? null,
        week,
      }))
    );
  }
  return { week, count: pool.length };
}

/**
 * Pool of great films the user has not watched (and not already listed).
 * Reads the weekly-built table; falls back to a live TMDB build when empty
 * (e.g. before the first cron run).
 */
export async function getUnseenGreatMoviesPool(
  excludeIds: Set<number>
): Promise<SurpriseMovie[]> {
  try {
    const rows = await db.select().from(surprisePool);
    if (rows.length > 0) {
      const out = rows
        .filter((r) => !excludeIds.has(r.tmdbId))
        .map((r) => ({
          tmdbId: r.tmdbId,
          title: r.title,
          posterPath: r.posterPath,
          releaseDate: r.releaseDate,
          runtime: r.runtime,
          rtScore: null,
          voteAverage: r.voteAverage,
          badge: r.badge ?? undefined,
        }));
      out.sort(
        (a, b) =>
          (b.voteAverage ?? 0) - (a.voteAverage ?? 0) ||
          a.title.localeCompare(b.title)
      );
      return out;
    }
  } catch (err) {
    console.error(
      "Surprise pool table read failed, falling back to live build:",
      err instanceof Error ? err.message : err
    );
  }

  // Fallback: live build (pre-cron) — the canon slices only
  const tagged = await fetchPoolCards(isoWeekKey());
  return dedupeAndSort(tagged, excludeIds);
}
