"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { backdropUrl, posterUrl } from "@/lib/tmdb";
import { ShowFollowButton } from "@/components/show-follow-button";
import { MovieWatchButton } from "@/components/movie-watch-button";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type ExploreHeroItem = {
  id: number;
  title: string;
  mediaType: "tv" | "movie";
  posterPath?: string | null;
  backdropPath?: string | null;
  overview?: string | null;
  badge?: string;
  following?: boolean;
  movieStatus?: string | null;
};

const AUTO_MS = 5500;

/**
 * Multi-item "Trending today" feature — swipe / arrows / auto-advance.
 * Not a single stagnant show.
 */
export function ExploreHeroCarousel({ items }: { items: ExploreHeroItem[] }) {
  const slides = items.slice(0, 5);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const count = slides.length;
  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      setIndex(((next % count) + count) % count);
    },
    [count]
  );

  useEffect(() => {
    if (count <= 1 || paused) return;
    const t = window.setInterval(() => go(index + 1), AUTO_MS);
    return () => window.clearInterval(t);
  }, [count, paused, index, go]);

  if (count === 0) return null;

  const item = slides[index];
  const href =
    item.mediaType === "tv" ? `/show/${item.id}` : `/movie/${item.id}`;
  const bg =
    backdropUrl(item.backdropPath, "w780") ||
    posterUrl(item.posterPath, "w500");

  return (
    <section
      className="mb-6"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
    >
      <div className="relative overflow-hidden rounded-2xl bg-card">
        {/* Key forces backdrop/poster swap without messy crossfade state */}
        <div key={item.id} className="relative">
          <Link href={href} className="block">
            <div className="relative h-48 w-full sm:h-56">
              {bg ? (
                <Image
                  src={bg}
                  alt=""
                  fill
                  sizes="100vw"
                  className="object-cover"
                  unoptimized
                  priority={index === 0}
                />
              ) : (
                <div className="h-full w-full bg-secondary" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/20" />
            </div>
          </Link>

          <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-3.5">
            <Link
              href={href}
              className="relative h-24 w-16 flex-shrink-0 overflow-hidden rounded-md bg-secondary shadow-lg ring-1 ring-white/10"
            >
              {item.posterPath ? (
                <Image
                  src={posterUrl(item.posterPath, "w185") ?? ""}
                  alt={item.title}
                  fill
                  sizes="64px"
                  className="object-cover"
                  unoptimized
                  priority={index === 0}
                />
              ) : null}
            </Link>

            <div className="min-w-0 flex-1 pb-0.5">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                {item.badge || "Trending today"}
                {count > 1 && (
                  <span className="ml-1.5 text-white/50">
                    {index + 1}/{count}
                  </span>
                )}
              </p>
              <Link href={href}>
                <h2 className="truncate text-lg font-black leading-tight text-white drop-shadow">
                  {item.title}
                </h2>
              </Link>
              {item.overview && (
                <p className="mt-1 line-clamp-2 text-xs leading-snug text-white/70">
                  {item.overview}
                </p>
              )}
              <div className="mt-2.5 flex items-center gap-2">
                {item.mediaType === "tv" ? (
                  <ShowFollowButton
                    tmdbId={item.id}
                    initialFollowing={!!item.following}
                    variant="compact"
                  />
                ) : (
                  <MovieWatchButton
                    tmdbId={item.id}
                    initialStatus={item.movieStatus ?? null}
                    variant="compact"
                  />
                )}
                <Link
                  href={href}
                  className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-sm"
                >
                  Details
                </Link>
              </div>
            </div>
          </div>
        </div>

        {count > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous"
              onClick={() => go(index - 1)}
              className="absolute left-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Next"
              onClick={() => go(index + 1)}
              className="absolute right-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  aria-label={`Show ${i + 1}`}
                  onClick={() => go(i)}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    i === index ? "w-4 bg-white" : "w-1.5 bg-white/40"
                  )}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
