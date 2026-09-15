/**
 * IMDb-ordered rankings for year/decade pages.
 *
 * Source: data/imdb-rankings/year-*.json, built by scripts/imdb-year-rankings.ts
 * from IMDb's official bulk datasets (Bayesian-weighted, 10K vote floor).
 *
 * TMDB stays as the poster/metadata layer: each IMDb entry (tconst) is
 * resolved to a TMDB id via /find, cached per-page in tmdb_list_cache
 * (7-day TTL) so the first visitor per week pays ~20 /find calls once.
 *
 * No JSON file for a year/decade → caller falls back to TMDB discover.
 * Nothing here throws for missing data — returns null and lets the
 * caller fall back.
 */
import { readFile } from "fs/promises";
import { join } from "path";
import { db, withDbRetry } from "./db";
import { tmdbListCache } from "./schema";
import { eq } from "drizzle-orm";
import { tmdbFetch, type TmdbMovieCard } from "./tmdb";

const PAGE_SIZE = 20;
const RANK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FIND_CONCURRENCY = 8;
/** Over-fetch so unresolvable tconsts don't leave short pages. */
const SLICE_BUFFER = 6;

export type ImdbRankedEntry = {
  tconst: string;
  title: string;
  year: number;
  rating: number;
  votes: number;
  score: number;
};

type RankedFile = {
  tag: string;
  /** ISO timestamp of the dataset build — versions the DB cache key. */
  builtAt?: string;
  mean: number;
  minVotes: number;
  items: ImdbRankedEntry[];
};

const fileCache = new Map<string, RankedFile | null>();

async function loadYearFile(year: number): Promise<RankedFile | null> {
  const key = `year-${year}`;
  if (fileCache.has(key)) return fileCache.get(key) ?? null;
  try {
    const raw = await readFile(
      join(process.cwd(), "data", "imdb-rankings", `${key}.json`),
      "utf-8"
    );
    const parsed = JSON.parse(raw) as RankedFile;
    if (!Array.isArray(parsed.items)) throw new Error("bad items");
    fileCache.set(key, parsed);
    return parsed;
  } catch {
    fileCache.set(key, null);
    return null;
  }
}

type FindResult = {
  id: number;
  title?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  overview?: string | null;
};

async function findTmdbByImdb(imdbId: string): Promise<FindResult | null> {
  try {
    const data = await tmdbFetch<{ movie_results?: FindResult[] }>(
      `/find/${imdbId}`,
      { external_source: "imdb_id" }
    );
    return data.movie_results?.[0] ?? null;
  } catch {
    return null;
  }
}

function toCard(entry: ImdbRankedEntry, found: FindResult): TmdbMovieCard {
  return {
    id: found.id,
    title: found.title || entry.title,
    poster_path: found.poster_path ?? null,
    backdrop_path: found.backdrop_path ?? null,
    mediaType: "movie",
    vote_average: entry.rating,
    vote_count: entry.votes,
    release_date: found.release_date ?? `${entry.year}-01-01`,
    overview: found.overview ?? null,
  };
}

async function mapConcurrent<T, R>(
  list: T[],
  size: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < list.length; i += size) {
    const chunk = await Promise.all(list.slice(i, i + size).map(fn));
    out.push(...chunk);
  }
  return out;
}

/** Resolve a slice of IMDb entries to TMDB cards, skipping unresolvable. */
async function resolveSlice(entries: ImdbRankedEntry[]): Promise<TmdbMovieCard[]> {
  const pairs = await mapConcurrent(entries, FIND_CONCURRENCY, async (entry) => ({
    entry,
    found: await findTmdbByImdb(entry.tconst),
  }));
  return pairs
    .filter((p): p is { entry: ImdbRankedEntry; found: FindResult } => p.found != null)
    .map((p) => toCard(p.entry, p.found));
}

function cacheKey(kind: "year" | "decade", value: string, page: number, version: string) {
  return `imdb-ranked:v${version}:${kind}:${value}:p${page}`;
}

async function readCache(key: string): Promise<TmdbMovieCard[] | null> {
  try {
    const rows = await withDbRetry(() =>
      db.select().from(tmdbListCache).where(eq(tmdbListCache.key, key)).limit(1)
    );
    const row = rows[0];
    if (!row) return null;
    const t =
      row.fetchedAt instanceof Date
        ? row.fetchedAt.getTime()
        : Date.parse(String(row.fetchedAt));
    if (!Number.isFinite(t) || Date.now() - t > RANK_TTL_MS) return null;
    const payload = row.payload as unknown;
    return Array.isArray(payload) ? (payload as TmdbMovieCard[]) : null;
  } catch {
    return null;
  }
}

async function writeCache(key: string, payload: TmdbMovieCard[]): Promise<void> {
  try {
    await withDbRetry(() =>
      db
        .insert(tmdbListCache)
        .values({ key, payload, fetchedAt: new Date() })
        .onConflictDoUpdate({
          target: tmdbListCache.key,
          set: { payload, fetchedAt: new Date() },
        })
    );
  } catch (err) {
    console.error(`imdb-rankings cache write failed ${key}:`, err instanceof Error ? err.message : err);
  }
}

export type ImdbPage = {
  items: TmdbMovieCard[];
  totalPages: number;
  totalResults: number;
};

async function pageFromEntries(
  kind: "year" | "decade",
  value: string,
  entries: ImdbRankedEntry[],
  page: number,
  version: string
): Promise<ImdbPage> {
  const totalResults = entries.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / PAGE_SIZE));
  const key = cacheKey(kind, value, page, version);
  const cached = await readCache(key);
  if (cached) return { items: cached, totalPages, totalResults };

  const start = (page - 1) * PAGE_SIZE;
  const slice = entries.slice(start, start + PAGE_SIZE + SLICE_BUFFER);
  const items = (await resolveSlice(slice)).slice(0, PAGE_SIZE);
  if (items.length > 0) await writeCache(key, items);
  return { items, totalPages, totalResults };
}

/** IMDb-ordered page for a single year, or null when no file exists. */
export async function getImdbYearPage(year: number, page: number): Promise<ImdbPage | null> {
  const file = await loadYearFile(year);
  if (!file || file.items.length === 0) return null;
  const version = (file.builtAt ?? "2026-09-15").slice(0, 10);
  return pageFromEntries("year", String(year), file.items, page, version);
}

/**
 * IMDb-ordered page for a decade. Needs files for every year from
 * start through min(start+9, current year) — partial decades fall back
 * to TMDB so the ranking never silently covers half the decade.
 *
 * Year files carry per-year adaptive floors, so their stored scores aren't
 * cross-comparable. The merge re-weights every film with a unified m=10K
 * against the decade mean — decade pages are the strictest view, not the
 * loosest. Pure math on stored rating/votes, no rebuild needed.
 */
export async function getImdbDecadePage(start: number, page: number): Promise<ImdbPage | null> {
  const now = new Date().getFullYear();
  const end = Math.min(start + 9, now);
  const files: RankedFile[] = [];
  for (let y = start; y <= end; y++) {
    const f = await loadYearFile(y);
    if (!f) return null;
    files.push(f);
  }
  const all = files.flatMap((f) => f.items);
  if (all.length === 0) return null;
  const M = 10000;
  const C = all.reduce((s, r) => s + r.rating, 0) / all.length;
  const merged = all
    .map((r) => ({
      ...r,
      score: (r.votes / (r.votes + M)) * r.rating + (M / (r.votes + M)) * C,
    }))
    .sort((a, b) => b.score - a.score);
  const version = files.map((f) => f.builtAt ?? "2026-09-15").sort().pop()!.slice(0, 10);
  return pageFromEntries("decade", `${start}s`, merged, page, version);
}
