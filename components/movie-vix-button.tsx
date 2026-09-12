"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, RotateCcw } from "lucide-react";
import { VixPlayer } from "@/components/vix-player";
import { vixMovieUrl } from "@/lib/vixsrc";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/utils";
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
    // State-colored hero CTA: solid yellow to start, yellow-tinted glass to
    // resume, neutral glass to rewatch — same language as the watchlist pill.
    const mode = resume ? "resume" : isWatched ? "rewatch" : "watch";
    return (
      <button
        type="button"
        onClick={() => {
          completionRef.current = false;
          setOpen(true);
        }}
        className={cn(
          "group relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-2xl px-4 py-2.5 text-center backdrop-blur-xl transition active:scale-[0.99]",
          mode === "watch" &&
            "bg-primary text-black shadow-[0_8px_24px_rgba(0,0,0,0.45)] hover:brightness-110",
          mode === "resume" &&
            "bg-primary/[0.14] text-primary ring-1 ring-primary/40 shadow-[0_8px_24px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.15)]",
          mode === "rewatch" &&
            "bg-white/[0.09] text-white ring-1 ring-white/15 shadow-[0_8px_24px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.15)] hover:bg-white/[0.13]"
        )}
      >
        {/* hairline top highlight — the only "sheen", kept faint */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
        />
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 backdrop-blur-xl transition",
            mode === "watch" && "bg-black/[0.12] text-black ring-black/20",
            mode === "resume" &&
              "bg-primary/20 text-primary ring-primary/40 group-hover:bg-primary/25",
            mode === "rewatch" &&
              "bg-white/[0.14] text-white ring-white/25 group-hover:bg-white/[0.2]"
          )}
        >
          {mode === "rewatch" ? (
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.5} />
          ) : (
            <Play className="h-3.5 w-3.5 fill-current" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-black leading-none">
            {resume ? "Resume" : isWatched ? "Rewatch now" : "Watch now"}
          </span>
          {resume?.timeLeft && (
            <span
              className={cn(
                "mt-0.5 block text-xs font-semibold",
                mode === "resume" ? "text-primary/70" : "text-white/60"
              )}
            >
              {resume.timeLeft} remaining
            </span>
          )}
        </span>
        {resume && (
          <span
            className={cn(
              "absolute right-4 flex h-1.5 w-14 shrink-0 overflow-hidden rounded-full",
              mode === "resume" ? "bg-primary/20" : "bg-white/20"
            )}
          >
            <span
              className={cn(
                "block h-full rounded-full",
                mode === "resume" ? "bg-primary" : "bg-white"
              )}
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
