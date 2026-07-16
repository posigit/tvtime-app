"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";

export function MovieWatchButton({
  tmdbId,
  initialStatus,
}: {
  tmdbId: number;
  initialStatus: string | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const newStatus = status === "watched" ? "want_to_watch" : "watched";
    setStatus(newStatus);
    startTransition(async () => {
      try {
        await fetch("/api/movie-watch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tmdbId,
            status: newStatus,
          }),
        });
      } catch (err) {
        setStatus(initialStatus);
      }
    });
  };

  const isWatched = status === "watched";

  return (
    <button
      onClick={toggle}
      disabled={pending}
      className={cn(
        "w-full rounded-xl py-3 text-sm font-bold transition-colors",
        isWatched
          ? "bg-primary text-black"
          : "bg-card text-white hover:bg-secondary"
      )}
    >
      {isWatched ? "✓ Watched" : "Mark as Watched"}
    </button>
  );
}
