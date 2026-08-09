"use client";

import Image from "next/image";
import { X } from "lucide-react";
import { stillUrl } from "@/lib/tmdb";

/**
 * Netflix-style up-next toast: small, bottom-right, subtle. A compact poster
 * thumbnail + "Up next" + title + circular countdown ring. No big buttons —
 * the whole card plays on tap, X cancels. Countdown ticks 9 → 1.
 */
export function UpNextCard({
  episode,
  currentSeason,
  countdown,
  onPlay,
  onCancel,
}: {
  episode: {
    title?: string;
    seasonNumber: number;
    episodeNumber: number;
    stillPath?: string | null;
  };
  currentSeason?: number;
  countdown: number;
  onPlay: () => void;
  onCancel: () => void;
}) {
  const still = stillUrl(episode.stillPath, "w185");
  // countdown > 0 → autoplay ring (10…1). 0 → manual play (autoplay off).
  const autoplay = countdown > 0;
  const progress = Math.max(0, Math.min(1, countdown / 10));
  const R = 14;
  const CIRC = 2 * Math.PI * R;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[110] flex justify-end p-3 pb-4 sm:p-5">
      {/* Play surface — whole card is the play button */}
      <button
        type="button"
        onClick={onPlay}
        className="relative flex w-72 items-center gap-3 overflow-hidden rounded-xl border border-white/10 bg-black/85 p-2.5 pl-3 pr-10 text-left shadow-2xl backdrop-blur transition hover:bg-black/90"
      >
        <div className="relative h-16 w-11 flex-shrink-0 overflow-hidden rounded-md bg-[#2c2c2e]">
          {still ? (
            <Image
              src={still}
              alt=""
              fill
              sizes="44px"
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="flex h-full items-center justify-center text-white/40">
              <span className="text-[8px] font-black">▶</span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
            {episode.seasonNumber > (currentSeason ?? 0)
              ? "Next season"
              : "Up next"}
          </p>
          <p className="truncate text-sm font-semibold text-white">
            {episode.title ||
              `S${episode.seasonNumber}E${episode.episodeNumber}`}
          </p>
          <p className="text-[10px] text-white/40">
            S{episode.seasonNumber}E{episode.episodeNumber}
          </p>
        </div>

        {/* Circular countdown ring, or play glyph when autoplay is off */}
        <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
          {autoplay ? (
            <>
              <svg
                width="34"
                height="34"
                viewBox="0 0 34 34"
                className="-rotate-90"
                aria-hidden="true"
              >
                <circle
                  cx="17"
                  cy="17"
                  r={R}
                  fill="none"
                  stroke="rgba(255,255,255,0.15)"
                  strokeWidth="3"
                />
                <circle
                  cx="17"
                  cy="17"
                  r={R}
                  fill="none"
                  stroke="#f5c518"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={CIRC}
                  strokeDashoffset={CIRC * (1 - progress)}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white">
                {Math.max(1, Math.ceil(countdown))}
              </span>
            </>
          ) : (
            <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-primary text-[11px] font-black text-black">
              ▶
            </span>
          )}
        </div>
      </button>

      {/* Cancel — sibling X, separate hit area (not nested inside the button) */}
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel"
        className="relative -ml-11 mr-4 mt-auto flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20 hover:text-white"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
