"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { posterUrl } from "@/lib/tmdb";
import { RatingBadge } from "@/components/star-rating";
import { SectionLabel } from "@/components/section-label";
import { Shuffle, Clock, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type LaterMovie = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  releaseDate: string | null;
  runtime: number | null;
  rtScore: number | null;
  rating?: number | null;
};

type SortKey = "title" | "rt" | "runtime" | "year";

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
 * Pick a random movie, avoiding recent surprises until the pool is exhausted.
 */
function pickSurprise(
  pool: LaterMovie[],
  recentIds: number[]
): LaterMovie | null {
  if (pool.length === 0) return null;
  const avoid = new Set(recentIds);
  let candidates = pool.filter((m) => !avoid.has(m.tmdbId));
  // If we've seen everything recently, only avoid the very last pick
  if (candidates.length === 0) {
    const last = recentIds[recentIds.length - 1];
    candidates =
      pool.length > 1
        ? pool.filter((m) => m.tmdbId !== last)
        : pool;
  }
  if (candidates.length === 0) return pool[0] ?? null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * @param items — Watch Later grid
 * @param surprisePool — full unwatched pool (Watch Next + Watch Later + …).
 *   Surprise Me draws from this, not only the later backlog.
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
  /** Session history of surprise picks — prevents the same title looping */
  const recentRef = useRef<number[]>([]);

  /** Everything we can pick from — never limited to Watch Later alone */
  const poolAll = useMemo(() => {
    const raw = surprisePool && surprisePool.length > 0 ? surprisePool : items;
    // Dedupe by tmdbId
    const seen = new Set<number>();
    const out: LaterMovie[] = [];
    for (const m of raw) {
      if (seen.has(m.tmdbId)) continue;
      seen.add(m.tmdbId);
      out.push(m);
    }
    return out;
  }, [surprisePool, items]);

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

    // Remember last up to poolSize-1 so we cycle through before repeats
    const maxRemember = Math.max(1, Math.min(poolAll.length - 1, 20));
    recentRef.current = [...recentRef.current, next.tmdbId].slice(-maxRemember);
    setPick(next);
  }

  // Show surprise UI if we have anything unwatched, even with empty Watch Later grid
  if (items.length === 0 && poolAll.length === 0) return null;

  const showLaterGrid = items.length > 0;

  return (
    <section className="mb-6">
      {/* Surprise draws from full unwatched list (Next + Later), not just Later */}
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
        <p className="text-[10px] text-muted-foreground">
          From {poolAll.length} unwatched movie
          {poolAll.length === 1 ? "" : "s"}
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
                Tonight&apos;s pick
              </p>
              <p className="truncate text-base font-bold text-white">
                {pick.title}
              </p>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-white/60">
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
            onClick={() => setPick(null)}
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
