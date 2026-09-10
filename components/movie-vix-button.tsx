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
 * True liquid glass: neutral frost, hairline highlight, no heavy sheen.
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
        className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-[1.25rem] bg-white/[0.08] px-4 py-3 text-center text-white shadow-[0_8px_24px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.15)] ring-1 ring-white/15 backdrop-blur-xl transition hover:bg-white/[0.12] active:scale-[0.99]"
      >
        {/* hairline top highlight — the only "sheen", kept faint */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
        />
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.14] text-white ring-1 ring-white/25 backdrop-blur-xl transition group-hover:bg-white/[0.2]">
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
