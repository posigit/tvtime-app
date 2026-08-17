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

/** Number of 2-day periods since epoch — this is what actually rotates the pool. */
export function rotationPeriod(date = new Date()): number {
  return Math.floor(date.getTime() / 86_400_000 / 2);
}

/** Cosmetic label stored on the row, e.g. "2026-P183". Trailing digits seed slices. */
export function periodKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-P${String(rotationPeriod(date)).padStart(4, "0")}`;
}

function periodNumber(key: string): number {
  const m = key.match(/(\d+)$/);
  return m ? Number(m[1]) : 0;
}

type Slice = { badge: string; fetch: () => Promise<TmdbMovieCard[]> };

/**
 * Deterministic rotation: sort axis + genre offset + deep page all derive
 * from the 2-day period number. Same period → same pool; next period → new
 * population. Rotating only the cron without changing the seed is a no-op.
 */
const SORTS = [
  "popularity.desc",
  "revenue.desc",
  "vote_count.desc",
  "primary_release_date.desc",
  "vote_average.desc",
] as const;

/** Genre id → badge. Rotating genre axes add variety that can't collapse. */
const GENRES: Array<{ id: string; label: string }> = [
  { id: "878", label: "Sci-fi" },
  { id: "53", label: "Thriller" },
  { id: "18", label: "Drama" },
  { id: "35", label: "Comedy" },
  { id: "9648", label: "Mystery" },
  { id: "28", label: "Action" },
  { id: "10749", label: "Romance" },
  { id: "27", label: "Horror" },
  { id: "16", label: "Animation" },
  { id: "10752", label: "War" },
  { id: "36", label: "History" },
  { id: "10402", label: "Music" },
];

function poolSlices(weekKey: string): Slice[] {
  const w = periodNumber(weekKey);
  // Pick 3 genre axes per period (rotating offset so all 12 surface over time)
  const genreStart = (w * 2) % GENRES.length;
  const genres = [
    GENRES[genreStart],
    GENRES[(genreStart + 4) % GENRES.length],
    GENRES[(genreStart + 8) % GENRES.length],
  ];

  const fail = () => Promise.resolve([] as TmdbMovieCard[]);
  const safe = (p: Promise<TmdbMovieCard[]>) => p.catch(fail);
  const sort = () => SORTS[w % SORTS.length];
  // Sample a deeper page so each week pulls a fresh slice of the catalog.
  const deepPage = (n: number) => 1 + ((w * 7 + n) % 12);
  // Looser gate: minVoteAverage 7.0 / count 300 keeps quality while massively
  // widening the pool of eligible films vs the old 7.5/800 wall.
  const L = { minVoteAverage: 7, minVoteCount: 300 };

  return [
    // Canon — keep just ONE page of top-rated as an anchor (was 5 pages of
    // the same ~100 movies; that wall is why the pool never looked different).
    { badge: "Top rated", fetch: () => safe(getTopRatedMoviesPage(1)) },

    // Rotating sort axis — a different population every period
    // (popularity / revenue / vote count / release date / score).
    ...[1, 2, 3].map((n) => ({
      badge: "Now trending",
      fetch: () => safe(discoverGreatMovies(deepPage(n), { sortBy: sort(), ...L })),
    })),

    // Genre axes (3 per week) — each with its own sort for variety.
    ...genres.map((g, i) => ({
      badge: g.label,
      fetch: () =>
        safe(
          discoverGreatMovies(deepPage(i + 1), {
            withGenres: g.id,
            sortBy: SORTS[(w + i) % SORTS.length],
            ...L,
          })
        ),
    })),

    // Critically acclaimed, rotating sort + deeper pages
    ...[1, 2].map((n) => ({
      badge: "Critically acclaimed",
      fetch: () =>
        safe(
          discoverGreatMovies(deepPage(n + 2), {
            sortBy: sort(),
            minVoteAverage: 7.6,
            minVoteCount: 400,
          })
        ),
    })),

    // All-time classics (pre-2000), rotating
    ...[1, 2].map((n) => ({
      badge: "Classic",
      fetch: () =>
        safe(
          discoverGreatMovies(deepPage(n + 4), {
            maxYear: 1999,
            minVoteAverage: 7.6,
            sortBy: sort(),
          })
        ),
    })),

    // Hidden gems: strong rating, low vote volume, rotating sort
    ...[1, 2].map((n) => ({
      badge: "Hidden gem",
      fetch: () =>
        safe(
          discoverGreatMovies(deepPage(n + 6), {
            minVoteAverage: 7.2,
            minVoteCount: 150,
            maxVoteCount: 799,
            sortBy: sort(),
          })
        ),
    })),

    // World cinema — rotating language groups
    ...[
      { lang: "fr|de|es|it", label: "European cinema" },
      { lang: "ja|ko|zh", label: "Asian cinema" },
      { lang: "hi|ar|tr|pt", label: "Global cinema" },
    ].map((g) => ({
      badge: g.label,
      fetch: () =>
        safe(
          discoverGreatMovies(deepPage(2), {
            originalLanguage: g.lang,
            sortBy: sort(),
            ...L,
          })
        ),
    })),
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
 * Rebuild the surprise pool table for the current 2-day period.
 * Called by the refresh cron and scripts/weekly-refresh.ts.
 */
export async function rebuildSurprisePool(): Promise<{
  week: string;
  count: number;
}> {
  const week = periodKey();
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
 * Reads the cron-built table; falls back to a live TMDB build when empty
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
  const tagged = await fetchPoolCards(periodKey());
  return dedupeAndSort(tagged, excludeIds);
}
