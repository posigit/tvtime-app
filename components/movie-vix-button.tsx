"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { VixPlayer } from "@/components/vix-player";
import { vixMovieUrl } from "@/lib/vixsrc";
import { useToast } from "@/components/toast";

/**
 * Primary "Watch now" button for movies — opens the VixSrc player.
 * Auto-marks the movie watched when playback ends.
 */
export function MovieVixButton({
  tmdbId,
  title,
  isWatched,
}: {
  tmdbId: number;
  title: string;
  isWatched: boolean;
}) {
  const [open, setOpen] = useState(false);
  const completionRef = useRef(false);
  const router = useRouter();
  const { toast } = useToast();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          completionRef.current = false;
          setOpen(true);
        }}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-black text-black transition hover:bg-primary/90 active:scale-[0.99]"
      >
        <Play className="h-4 w-4 fill-black" />
        Watch now
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
      onEvent={handleEvent}
      onClose={() => setOpen(false)}
    />
  );
}
