"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, RotateCcw } from "lucide-react";
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
    // True frosted glass: translucent white fill over the page's deep-theme
    // wash (refraction does the tinting) + theme bloom in the shadow.
    // A faint theme pool inside keeps dark-poster buttons from going gray.
    const mode = resume ? "resume" : isWatched ? "rewatch" : "watch";
    return (
      <button
        type="button"
        onClick={() => {
          completionRef.current = false;
          setOpen(true);
        }}
        className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-2xl px-4 py-2.5 text-center text-white ring-1 ring-white/35 backdrop-blur-2xl backdrop-saturate-150 transition active:scale-[0.99]"
        style={{
          background:
            "linear-gradient(155deg, rgba(255, 255, 255, 0.17), rgba(255, 255, 255, 0.05) 48%, rgba(255, 255, 255, 0.1))",
          boxShadow:
            "0 12px 32px rgba(0, 0, 0, 0.5), 0 0 72px rgb(var(--theme, 255 255 255) / 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.5), inset 0 -1px 0 rgba(255, 255, 255, 0.08)",
        }}
      >
        {/* theme pool across the top — tints the frost, reads on dark pages */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 130% at 50% 0%, rgb(var(--theme, 255 255 255) / 0.35), transparent 70%)",
          }}
        />
        {/* diagonal gloss — the light reflection */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(115deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.03) 28%, transparent 45%)",
          }}
        />
        {/* hairline top highlight — the only "sheen", kept faint */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent"
        />
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.22] text-white ring-1 ring-white/60 backdrop-blur-2xl backdrop-saturate-150 transition group-hover:scale-105"
          style={{
            boxShadow:
              "0 12px 32px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.55), 0 0 56px rgb(var(--theme, 255 255 255) / 0.7)",
          }}
        >
          {mode === "rewatch" ? (
            <RotateCcw className="h-4 w-4" strokeWidth={2.5} />
          ) : (
            <Play className="h-4 w-4 fill-current" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-black leading-none">
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
              className="block h-full rounded-full"
              style={{
                width: `${playback?.progressPercent ?? 0}%`,
                background: "rgb(var(--theme, 255 255 255))",
              }}
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
