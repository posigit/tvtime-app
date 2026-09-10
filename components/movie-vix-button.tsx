"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { VixPlayer } from "@/components/vix-player";
import { vixMovieUrl } from "@/lib/vixsrc";
import { useToast } from "@/components/toast";
import type { PlaybackSummary } from "@/lib/playback";
import { formatPlaybackTime } from "@/lib/playback-format";

/**
 * Primary "Watch now" button for movies — opens the VixSrc player.
 * Auto-marks the movie watched when playback ends; when the movie is already
 * watched (e.g. a queued rewatch), finishing logs a rewatch stamp instead.
 * When a saved position exists, becomes a "Resume · time left" CTA.
 * Liquid-glass pill tinted by the page theme (--theme set by detail pages).
 */
export function MovieVixButton({
  tmdbId,
  title,
  isWatched,
  isRewatchQueued,
  playback,
}: {
  tmdbId: number;
  title: string;
  isWatched: boolean;
  isRewatchQueued?: boolean;
  playback?: PlaybackSummary | null;
}) {
  const [open, setOpen] = useState(false);
  const completionRef = useRef(false);
  const router = useRouter();
  const { toast } = useToast();

  if (!open) {
    const resume = playback
      ? { timeLeft: formatPlaybackTime(playback.timeLeftSeconds) }
      : null;
    return (
      <button
        type="button"
        onClick={() => {
          completionRef.current = false;
          setOpen(true);
        }}
        className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-[1.25rem] bg-[rgb(var(--theme)/0.26)] px-4 py-3 text-center text-white shadow-[0_12px_32px_rgb(var(--theme)/0.35),inset_0_1px_0_rgba(255,255,255,0.35)] ring-1 ring-white/30 backdrop-blur-2xl transition hover:bg-[rgb(var(--theme)/0.36)] active:scale-[0.99]"
      >
        {/* liquid-glass sheen across the top edge */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-6 top-0 h-1/2 rounded-b-full bg-gradient-to-b from-white/40 to-transparent opacity-70"
        />
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--theme)/0.9)] text-white shadow-[0_0_20px_rgb(var(--theme)/0.6)] transition group-hover:scale-105">
          <Play className="h-4 w-4 fill-current" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-black">
            {resume ? "Resume" : isWatched ? "Rewatch now" : "Watch now"}
          </span>
          {resume?.timeLeft && (
            <span className="mt-0.5 block text-xs font-semibold text-white/60">
              {resume.timeLeft} remaining
            </span>
          )}
        </span>
        {resume && (
          <span className="absolute right-4 flex h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-white/20">
            <span
              className="block h-full rounded-full bg-white"
              style={{ width: `${playback?.progressPercent ?? 0}%` }}
            />
          </span>
        )}
      </button>
    );
  }

  const handleEvent = async (event: string) => {
    if (event !== "ended") return;
    if (completionRef.current) return;
    completionRef.current = true;
    try {
      if (isWatched) {
        // Finishing an already-watched title = a rewatch. Stamp history and
        // clear the queue flag so Watch Next drops it.
        const res = await fetch("/api/movie-rewatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tmdbId, mode: "log" }),
        });
        if (!res.ok) throw new Error("save failed");
        toast(
          isRewatchQueued ? "Rewatch logged — nice one!" : "Rewatch logged!"
        );
      } else {
        const res = await fetch("/api/movie-watch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tmdbId, status: "watched" }),
        });
        if (!res.ok) throw new Error("save failed");
        toast("Watched — nice one!");
      }
      router.refresh();
    } catch {
      completionRef.current = false;
      toast("Couldn't mark watched", "error");
    }
  };

  return (
    <VixPlayer
      src={vixMovieUrl(tmdbId)}
      type="movie"
      tmdbId={tmdbId}
      title={title}
      initialPosition={playback?.positionSeconds}
      autoResume={Boolean(playback)}
      onEvent={handleEvent}
      onClose={() => {
        setOpen(false);
        // Re-fetch playback server state so the CTA reflects saved progress.
        router.refresh();
      }}
    />
  );
}
