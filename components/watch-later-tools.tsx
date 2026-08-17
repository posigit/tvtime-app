"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { posterUrl } from "@/lib/tmdb";
import { RatingBadge } from "@/components/star-rating";
import { SectionLabel } from "@/components/section-label";
import { Shuffle, Clock, X, Star } from "lucide-react";
import { cn } from "@/lib/utils";

export type LaterMovie = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  releaseDate: string | null;
  runtime: number | null;
  rtScore: number | null;
  rating?: number | null;
  /** TMDB score 0–10 for surprise classics */
  voteAverage?: number | null;
  badge?: string;
};

type SortKey = "title" | "rt" | "runtime" | "year";

const PICK_KEY = "surprise-pick";
const RECENT_KEY = "surprise-recent";
const PICK_TTL_MS = 10 * 60 * 1000;

type StoredPick = { movie: LaterMovie; savedAt: number };

function readStoredPick(): LaterMovie | null {
  const stored = readJson<StoredPick>(PICK_KEY);
  if (!stored?.movie || typeof stored.movie.tmdbId !== "number") {
    clearStoredPick();
    return null;
  }
  if (
    typeof stored.savedAt !== "number" ||
    Date.now() - stored.savedAt >= PICK_TTL_MS
  ) {
    clearStoredPick();
    return null;
  }
  return stored.movie;
}

function writeStoredPick(movie: LaterMovie) {
  writeJson(PICK_KEY, { movie, savedAt: Date.now() } satisfies StoredPick);
}

function pickRemainingMs(): number {
  const stored = readJson<StoredPick>(PICK_KEY);
  if (!stored || typeof stored.savedAt !== "number") return 0;
  return Math.max(0, PICK_TTL_MS - (Date.now() - stored.savedAt));
}

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

function clearStoredPick() {
  try {
    sessionStorage.removeItem(PICK_KEY);
  } catch {
    /* ignore */
  }
}

function formatRuntime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function MoviePoster({
  title,
  posterPath,
  rating,
  highlighted,
}: {
  title: string;
  posterPath: string | null;
  rating?: number | null;
  highlighted?: boolean;
}) {
  return (
    <div
      style={{ aspectRatio: "2 / 3" }}
      className={cn(
        "relative w-full overflow-hidden bg-secondary",
        highlighted && "ring-2 ring-primary"
      )}
    >
      {rating != null && <RatingBadge value={rating} />}
      {posterPath ? (
        <Image
          src={posterUrl(posterPath, "w342") ?? ""}
          alt={title}
          fill
          sizes="(max-width: 768px) 33vw, 200px"
          className="object-cover"
          unoptimized
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[#3a7bd5] p-2 text-center">
          <span className="text-xs font-medium text-white">{title}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Weighted random: higher TMDB scores more likely, still avoids recent picks.
 */
function pickSurprise(
  pool: LaterMovie[],
  recentIds: number[]
): LaterMovie | null {
  if (pool.length === 0) return null;
  const avoid = new Set(recentIds);
  let candidates = pool.filter((m) => !avoid.has(m.tmdbId));
  if (candidates.length === 0) {
    const last = recentIds[recentIds.length - 1];
    candidates =
      pool.length > 1 ? pool.filter((m) => m.tmdbId !== last) : pool;
  }
  if (candidates.length === 0) return pool[0] ?? null;

  // Weight by vote average (fallback equal weight)
  const weights = candidates.map((m) => {
    const v = m.voteAverage ?? 7;
    return Math.max(0.5, (v - 6) ** 2);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/**
 * @param items — Watch Later grid
 * @param surprisePool — great/classic films user hasn't seen (from TMDB)
 */
export function WatchLaterTools({
  items,
  surprisePool,
}: {
  items: LaterMovie[];
  surprisePool?: LaterMovie[];
}) {
  const [sort, setSort] = useState<SortKey>("rt");
  const [pick, setPick] = useState<LaterMovie | null>(null);
  const recentRef = useRef<number[]>([]);
  const hydratedRef = useRef(false);

  useEffect(() => {
    const storedRecent = readJson<number[]>(RECENT_KEY);
    if (Array.isArray(storedRecent)) {
      recentRef.current = storedRecent.filter((id) => Number.isFinite(id));
    }
    const stored = readStoredPick();
    if (stored) setPick(stored);
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!pick) return;
    const left = pickRemainingMs();
    if (left <= 0) {
      clearStoredPick();
      setPick(null);
      return;
    }
    const t = window.setTimeout(() => {
      clearStoredPick();
      setPick(null);
    }, left);
    return () => window.clearTimeout(t);
  }, [pick]);

  const poolAll = useMemo(() => {
    const raw = surprisePool && surprisePool.length > 0 ? surprisePool : items;
    const seen = new Set<number>();
    const out: LaterMovie[] = [];
    for (const m of raw) {
      if (seen.has(m.tmdbId)) continue;
      seen.add(m.tmdbId);
      out.push(m);
    }
    return out;
  }, [surprisePool, items]);

  useEffect(() => {
    if (!hydratedRef.current || !pick) return;
    if (poolAll.length === 0) return;
    if (!poolAll.some((m) => m.tmdbId === pick.tmdbId)) {
      setPick(null);
      clearStoredPick();
    }
  }, [pick, poolAll]);

  const sorted = useMemo(() => {
    const list = [...items];
    list.sort((a, b) => {
      if (sort === "rt") {
        const ar = a.rtScore != null && a.rtScore >= 0 ? a.rtScore : -1;
        const br = b.rtScore != null && b.rtScore >= 0 ? b.rtScore : -1;
        if (br !== ar) return br - ar;
        return a.title.localeCompare(b.title);
      }
      if (sort === "runtime") {
        const ar = a.runtime ?? 9999;
        const br = b.runtime ?? 9999;
        if (ar !== br) return ar - br;
        return a.title.localeCompare(b.title);
      }
      if (sort === "year") {
        const ay = a.releaseDate?.slice(0, 4) ?? "0000";
        const by = b.releaseDate?.slice(0, 4) ?? "0000";
        if (by !== ay) return by.localeCompare(ay);
        return a.title.localeCompare(b.title);
      }
      return a.title.localeCompare(b.title);
    });
    return list;
  }, [items, sort]);

  function surprise() {
    if (poolAll.length === 0) return;
    const next = pickSurprise(poolAll, recentRef.current);
    if (!next) return;
    const maxRemember = Math.max(1, Math.min(poolAll.length - 1, 30));
    recentRef.current = [...recentRef.current, next.tmdbId].slice(-maxRemember);
    writeJson(RECENT_KEY, recentRef.current);
    writeStoredPick(next);
    setPick(next);
  }

  if (items.length === 0 && poolAll.length === 0) return null;

  const showLaterGrid = items.length > 0;

  return (
    <section className="mb-6">
      <div className="mb-3 mt-2 flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={surprise}
          disabled={poolAll.length === 0}
          className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-black uppercase tracking-wide text-black active:scale-95 disabled:opacity-40"
        >
          <Shuffle className="h-3.5 w-3.5" />
          {pick ? "Surprise again" : "Surprise me"}
        </button>
        <p className="max-w-xs text-center text-[10px] leading-snug text-muted-foreground">
          Top-rated &amp; classics you haven&apos;t watched · {poolAll.length}{" "}
          films
        </p>
      </div>

      {pick && (
        <div className="relative mb-4">
          <Link
            href={`/movie/${pick.tmdbId}`}
            className="flex gap-3 overflow-hidden rounded-xl border border-primary/40 bg-card p-3"
          >
            <div className="relative h-24 w-16 flex-shrink-0 overflow-hidden rounded-md bg-secondary">
              {pick.posterPath ? (
                <Image
                  src={posterUrl(pick.posterPath, "w185") ?? ""}
                  alt={pick.title}
                  fill
                  className="object-cover"
                  unoptimized
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1 pr-6">
              <p className="text-[10px] font-bold uppercase tracking-wide text-primary">
                {pick.badge
                  ? `${pick.badge} · tonight`
                  : "Tonight\u2019s pick"}
              </p>
              <p className="truncate text-base font-bold text-white">
                {pick.title}
              </p>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-white/60">
                {pick.voteAverage != null && pick.voteAverage > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-primary">
                    <Star className="h-3 w-3" fill="currentColor" />
                    {pick.voteAverage.toFixed(1)}
                  </span>
                )}
                {pick.rtScore != null && pick.rtScore >= 0 && (
                  <span className="text-primary">🍅 {pick.rtScore}%</span>
                )}
                {pick.runtime != null && (
                  <span className="inline-flex items-center gap-0.5">
                    <Clock className="h-3 w-3" />
                    {formatRuntime(pick.runtime)}
                  </span>
                )}
                {pick.releaseDate && (
                  <span>{pick.releaseDate.slice(0, 4)}</span>
                )}
              </div>
            </div>
          </Link>
          <button
            type="button"
            aria-label="Dismiss pick"
            onClick={() => {
              clearStoredPick();
              setPick(null);
            }}
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white/80"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {showLaterGrid && (
        <>
          <div className="mb-3 mt-4 flex flex-wrap items-center justify-center gap-2">
            <SectionLabel>
              Watch Later
              <span className="ml-1.5 font-semibold normal-case tracking-normal text-white/50">
                · {items.length}
              </span>
            </SectionLabel>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {(
              [
                ["rt", "🍅 RT"],
                ["runtime", "Shortest"],
                ["year", "Newest"],
                ["title", "A–Z"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSort(key)}
                className={
                  sort === key
                    ? "rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold text-white"
                    : "rounded-full bg-card px-3 py-1.5 text-xs font-medium text-white/60"
                }
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {sorted.map((movie) => (
              <Link
                key={movie.tmdbId}
                href={`/movie/${movie.tmdbId}`}
                className="overflow-hidden rounded-md bg-card"
              >
                <MoviePoster
                  title={movie.title}
                  posterPath={movie.posterPath}
                  rating={movie.rating}
                  highlighted={pick?.tmdbId === movie.tmdbId}
                />
                {(movie.rtScore != null && movie.rtScore >= 0) ||
                movie.runtime != null ? (
                  <p className="px-1 py-1 text-center text-[10px] font-bold text-primary">
                    {movie.rtScore != null && movie.rtScore >= 0
                      ? `🍅 ${movie.rtScore}%`
                      : ""}
                    {movie.rtScore != null &&
                    movie.rtScore >= 0 &&
                    movie.runtime != null
                      ? " · "
                      : ""}
                    {movie.runtime != null
                      ? formatRuntime(movie.runtime)
                      : ""}
                  </p>
                ) : null}
              </Link>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
