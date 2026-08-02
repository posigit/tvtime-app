"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { backdropUrl, posterUrl } from "@/lib/tmdb";
import { ShowFollowButton } from "@/components/show-follow-button";
import { MovieWatchButton } from "@/components/movie-watch-button";

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

const AUTO_MS = 5000;

/**
 * "Trending today" — snap strip with auto-advance.
 * No left/right chrome; swipe manually or let it rotate.
 */
export function ExploreHeroCarousel({ items }: { items: ExploreHeroItem[] }) {
  const slides = items.slice(0, 6);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);
  const pausedRef = useRef(false);
  const [active, setActive] = useState(0);

  const scrollToIndex = (i: number, behavior: ScrollBehavior = "smooth") => {
    const el = scrollerRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>(`[data-hero-i="${i}"]`);
    if (!card) return;
    // Align card to start of scroller (accounts for padding)
    const left = card.offsetLeft - el.offsetLeft;
    el.scrollTo({ left, behavior });
  };

  useEffect(() => {
    if (slides.length <= 1) return;

    const id = window.setInterval(() => {
      if (pausedRef.current) return;
      const next = (indexRef.current + 1) % slides.length;
      indexRef.current = next;
      setActive(next);
      scrollToIndex(next, "smooth");
    }, AUTO_MS);

    return () => window.clearInterval(id);
  }, [slides.length]);

  // Keep index in sync when user swipes manually
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || slides.length <= 1) return;

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const cards = el.querySelectorAll<HTMLElement>("[data-hero-i]");
        const scrollMid = el.scrollLeft + el.clientWidth * 0.35;
        let best = 0;
        let bestDist = Infinity;
        cards.forEach((card) => {
          const i = Number(card.dataset.heroI);
          const dist = Math.abs(card.offsetLeft - el.offsetLeft - el.scrollLeft);
          // Prefer card whose left edge is near scrollLeft
          const d = Math.abs(card.offsetLeft - el.offsetLeft - scrollMid + card.clientWidth / 2);
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
          void dist;
        });
        indexRef.current = best;
        setActive(best);
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [slides.length]);

  if (slides.length === 0) return null;

  const pause = () => {
    pausedRef.current = true;
  };
  const resume = () => {
    // brief delay so a flick doesn't immediately jump
    window.setTimeout(() => {
      pausedRef.current = false;
    }, 4000);
  };

  return (
    <section className="mb-6">
      <div className="mb-2.5 flex items-baseline justify-between px-0.5">
        <p className="text-[11px] font-black uppercase tracking-wider text-primary">
          Trending today
        </p>
        {slides.length > 1 && (
          <p className="text-[10px] font-medium text-muted-foreground">
            {active + 1}/{slides.length}
          </p>
        )}
      </div>

      <div
        ref={scrollerRef}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ WebkitOverflowScrolling: "touch" }}
        onPointerDown={pause}
        onPointerUp={resume}
        onTouchStart={pause}
        onTouchEnd={resume}
      >
        {slides.map((item, i) => {
          const href =
            item.mediaType === "tv"
              ? `/show/${item.id}`
              : `/movie/${item.id}`;
          const bg =
            backdropUrl(item.backdropPath, "w780") ||
            posterUrl(item.posterPath, "w500");

          return (
            <article
              key={`${item.mediaType}-${item.id}`}
              data-hero-i={i}
              className="relative w-[min(86vw,22rem)] flex-shrink-0 snap-center overflow-hidden rounded-2xl bg-card"
            >
              <Link href={href} className="block">
                <div className="relative h-44 w-full">
                  {bg ? (
                    <Image
                      src={bg}
                      alt=""
                      fill
                      sizes="86vw"
                      className="object-cover"
                      unoptimized
                      priority={i === 0}
                    />
                  ) : (
                    <div className="h-full w-full bg-secondary" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-black/15" />
                </div>
              </Link>

              <div className="absolute inset-x-0 bottom-0 flex items-end gap-2.5 p-3">
                <Link
                  href={href}
                  className="relative h-20 w-14 flex-shrink-0 overflow-hidden rounded-md bg-secondary shadow-lg ring-1 ring-white/10"
                >
                  {item.posterPath ? (
                    <Image
                      src={posterUrl(item.posterPath, "w185") ?? ""}
                      alt={item.title}
                      fill
                      sizes="56px"
                      className="object-cover"
                      unoptimized
                      priority={i === 0}
                    />
                  ) : null}
                </Link>

                <div className="min-w-0 flex-1">
                  <p className="mb-0.5 text-[9px] font-bold uppercase tracking-wider text-primary/90">
                    {item.mediaType === "tv" ? "Series" : "Film"}
                    {item.badge ? ` · ${item.badge}` : ""}
                  </p>
                  <Link href={href}>
                    <h2 className="line-clamp-2 text-[15px] font-black leading-tight text-white drop-shadow">
                      {item.title}
                    </h2>
                  </Link>
                  {item.overview && (
                    <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-white/65">
                      {item.overview}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
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
                      className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm"
                    >
                      Details
                    </Link>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
        <div className="w-2 flex-shrink-0" aria-hidden />
      </div>
    </section>
  );
}
