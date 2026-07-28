"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { posterUrl } from "@/lib/tmdb";
import { RatingBadge } from "@/components/star-rating";
import { SectionLabel } from "@/components/section-label";
import { Shuffle, Clock } from "lucide-react";

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

function MoviePoster({
  title,
  posterPath,
  rating,
}: {
  title: string;
  posterPath: string | null;
  rating?: number | null;
}) {
  return (
    <div
      style={{ aspectRatio: "2 / 3" }}
      className="relative w-full overflow-hidden bg-secondary"
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

export function WatchLaterTools({ items }: { items: LaterMovie[] }) {
  const [sort, setSort] = useState<SortKey>("rt");
  const [pick, setPick] = useState<LaterMovie | null>(null);

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

  const shortlist = useMemo(
    () =>
      items.filter(
        (m) =>
          (m.runtime == null || m.runtime <= 130) &&
          (m.rtScore == null || m.rtScore < 0 || m.rtScore >= 75)
      ),
    [items]
  );

  function surprise() {
    const pool = shortlist.length > 0 ? shortlist : items;
    if (pool.length === 0) return;
    setPick(pool[Math.floor(Math.random() * pool.length)]);
  }

  if (items.length === 0) return null;

  return (
    <section className="mb-6">
      <div className="mb-3 mt-2 flex justify-center">
        <SectionLabel>Watch Later</SectionLabel>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={surprise}
          className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-black uppercase tracking-wide text-black"
        >
          <Shuffle className="h-3.5 w-3.5" />
          Surprise me
        </button>
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

      {pick && (
        <Link
          href={`/movie/${pick.tmdbId}`}
          className="mb-4 flex gap-3 overflow-hidden rounded-xl border border-primary/40 bg-card p-3"
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
          <div className="min-w-0 flex-1">
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
                  {Math.floor(pick.runtime / 60)}h {pick.runtime % 60}m
                </span>
              )}
            </div>
          </div>
        </Link>
      )}

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
                  ? `${Math.floor(movie.runtime / 60)}h${movie.runtime % 60}`
                  : ""}
              </p>
            ) : null}
          </Link>
        ))}
      </div>
    </section>
  );
}
