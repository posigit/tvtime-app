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
 * Auto-marks the movie watched when playback ends.
 * When a saved position exists, becomes a "Resume · time left" CTA.
 */
export function MovieVixButton({
  tmdbId,
  title,
  isWatched,
  playback,
}: {
  tmdbId: number;
  title: string;
  isWatched: boolean;
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
        className="group relative flex w-full items-center justify-center gap-3 rounded-2xl bg-primary px-4 py-3 text-center text-black transition hover:bg-primary/90 active:scale-[0.99]"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black text-primary transition group-hover:scale-105">
          <Play className="h-4 w-4 fill-current" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-black">
            {resume ? "Resume" : "Watch now"}
          </span>
          {resume?.timeLeft && (
            <span className="mt-0.5 block text-xs font-semibold text-black/60">
              {resume.timeLeft} remaining
            </span>
          )}
        </span>
        {resume && (
          <span className="absolute right-4 flex h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-black/20">
            <span
              className="block h-full rounded-full bg-black"
              style={{ width: `${playback?.progressPercent ?? 0}%` }}
            />
          </span>
        )}
      </button>
    );
  }

  const handleEvent = async (event: string) => {
    if (event !== "ended" || isWatched) return;
    if (completionRef.current) return;
    completionRef.current = true;
    try {
      const res = await fetch("/api/movie-watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId, status: "watched" }),
      });
      if (!res.ok) throw new Error("save failed");
      toast("Watched — nice one!");
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
