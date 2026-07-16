"use client";

import { useState, useTransition } from "react";
import { stillUrl } from "@/lib/tmdb";
import { cn } from "@/lib/utils";

export type EpisodeData = {
  episodeNumber: number;
  seasonNumber: number;
  name: string;
  overview?: string;
  airDate?: string;
  stillPath?: string | null;
  runtime?: number;
  watched: boolean;
};

export function EpisodeRow({
  episode,
  showTmdbId,
}: {
  episode: EpisodeData;
  showTmdbId: number;
}) {
  const [watched, setWatched] = useState(episode.watched);
  const [pending, startTransition] = useTransition();

  const toggleWatched = () => {
    const newValue = !watched;
    setWatched(newValue);
    startTransition(async () => {
      try {
        await fetch("/api/watch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            showTmdbId,
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.episodeNumber,
            watched: newValue,
          }),
        });
      } catch (err) {
        setWatched(!newValue);
      }
    });
  };

  return (
    <div className="flex items-start gap-3 rounded-xl bg-card p-3">
      <div className="relative h-16 w-28 flex-shrink-0 overflow-hidden rounded-lg bg-secondary">
        {episode.stillPath ? (
          <img
            src={stillUrl(episode.stillPath, "w300") ?? ""}
            alt={episode.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            No img
          </div>
        )}
        {watched && (
          <div className="absolute inset-0 bg-black/50" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">
          E{episode.episodeNumber}. {episode.name}
        </p>
        {episode.airDate && (
          <p className="text-xs text-muted-foreground">
            {new Date(episode.airDate).toLocaleDateString("en-US", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
        )}
        {episode.overview && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{episode.overview}</p>
        )}
      </div>

      <button
        onClick={toggleWatched}
        disabled={pending}
        className={cn(
          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          watched
            ? "border-primary bg-primary text-black"
            : "border-muted text-muted hover:border-primary hover:text-primary"
        )}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </button>
    </div>
  );
}
