"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import { stillUrl } from "@/lib/tmdb";
import { cn } from "@/lib/utils";
import { isEpisodeAired } from "@/lib/show-progress";

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
  onToggle,
}: {
  episode: EpisodeData;
  showTmdbId: number;
  onToggle?: (watched: boolean) => void | Promise<void>;
}) {
  const [watched, setWatched] = useState(episode.watched);
  const [pending, startTransition] = useTransition();
  const aired = isEpisodeAired(episode.airDate);

  useEffect(() => {
    setWatched(episode.watched);
  }, [episode.watched]);

  const toggleWatched = () => {
    // Cannot mark unaired episodes as watched
    if (!aired && !watched) {
      return;
    }

    const newValue = !watched;
    setWatched(newValue);
    startTransition(async () => {
      try {
        if (onToggle) {
          await onToggle(newValue);
        } else {
          if (newValue && !isEpisodeAired(episode.airDate)) {
            setWatched(false);
            return;
          }
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
        }
      } catch {
        setWatched(!newValue);
      }
    });
  };

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl bg-card p-3",
        !aired && !watched && "opacity-70"
      )}
    >
      <div className="relative h-16 w-28 flex-shrink-0 overflow-hidden rounded-lg bg-secondary">
        {episode.stillPath ? (
          <Image
            src={stillUrl(episode.stillPath, "w300") ?? ""}
            alt={episode.name}
            fill
            sizes="112px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            No img
          </div>
        )}
        {watched && <div className="absolute inset-0 bg-black/50" />}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">
          E{episode.episodeNumber}. {episode.name}
        </p>
        {episode.airDate && (
          <p className="text-xs text-muted-foreground">
            {new Date(
              episode.airDate.includes("T")
                ? episode.airDate
                : episode.airDate + "T12:00:00"
            ).toLocaleDateString("en-US", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            {!aired && (
              <span className="ml-1 text-primary">· Not aired yet</span>
            )}
          </p>
        )}
        {episode.overview && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {episode.overview}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={toggleWatched}
        disabled={pending || (!aired && !watched)}
        title={
          !aired && !watched
            ? "This episode has not aired yet"
            : watched
              ? "Mark unwatched"
              : "Mark watched"
        }
        className={cn(
          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          watched
            ? "border-primary bg-primary text-black"
            : !aired
              ? "cursor-not-allowed border-white/10 text-white/20"
              : "border-muted text-muted hover:border-primary hover:text-primary"
        )}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </button>
    </div>
  );
}
