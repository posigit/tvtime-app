"use client";

import Image from "next/image";
import { Play } from "lucide-react";
import { stillUrl } from "@/lib/tmdb";

/** Overlay card shown when an episode ends and autoplay is queued. */
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
  const still = stillUrl(episode.stillPath);
  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-end p-5 sm:items-start sm:p-6">
      <div className="w-full max-w-xs overflow-hidden rounded-2xl border border-white/10 bg-card/95 shadow-2xl backdrop-blur">
        <div className="relative aspect-video bg-black">
          {still ? (
            <Image
              src={still}
              alt=""
              fill
              sizes="(max-width: 24rem) 100vw"
              className="object-cover opacity-90"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-white/40">
              <Play className="h-8 w-8" />
            </div>
          )}
          <div className="absolute left-3 top-3 rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-black">
            Up next in {countdown}s
          </div>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {episode.seasonNumber > (currentSeason ?? 0)
                ? "Next season"
                : "Next episode"}
            </p>
            <p className="text-sm font-bold leading-snug text-white">
              {episode.title ||
                `S${episode.seasonNumber}E${episode.episodeNumber}`}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onPlay}
              className="flex-1 rounded-full bg-primary py-2 text-sm font-bold text-black transition hover:bg-primary/90"
            >
              Play now
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-full border border-white/20 py-2 text-sm font-medium text-white transition hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}