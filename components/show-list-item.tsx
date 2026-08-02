"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { posterUrl, stillUrl } from "@/lib/tmdb";
import { MarkWatchedButton } from "./mark-watched-button";
import { ChevronRight } from "lucide-react";

export type ShowListItemData = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  nextEpisode?: {
    seasonNumber: number;
    episodeNumber: number;
    title: string;
    stillPath?: string | null;
  } | null;
  remaining: number;
};

/** Row from snapshot 1: episode still | title pill + Sxx | Exx + episode name | white check */
export function ShowListItem({ show }: { show: ShowListItemData }) {
  const [dismissed, setDismissed] = useState(false);
  const hasNext = show.nextEpisode != null;
  const still = hasNext
    ? stillUrl(show.nextEpisode!.stillPath, "w300")
    : null;
  const poster = posterUrl(show.posterPath, "w154");

  // Instant dismiss after optimistic mark — parent refresh fills next episode later
  if (dismissed) return null;

  return (
    <div className="flex items-center gap-3 rounded-xl bg-[#101011] p-2.5">
      <Link
        href={`/show/${show.tmdbId}`}
        className="relative h-[72px] w-[116px] flex-shrink-0 overflow-hidden rounded-lg bg-[#2c2c2e]"
      >
        {still ? (
          <Image
            src={still}
            alt={show.title}
            fill
            sizes="116px"
            className="object-cover"
            unoptimized
          />
        ) : poster ? (
          <Image
            src={poster}
            alt={show.title}
            fill
            sizes="116px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
            No img
          </div>
        )}
      </Link>

      <Link href={`/show/${show.tmdbId}`} className="min-w-0 flex-1 py-0.5">
        <div className="mb-1.5 inline-flex max-w-full items-center gap-0.5 rounded-full border border-white/90 px-2.5 py-[3px]">
          <span className="truncate text-[11px] font-bold uppercase tracking-wide text-white">
            {show.title}
          </span>
          <ChevronRight className="h-3 w-3 flex-shrink-0 text-white" strokeWidth={2.5} />
        </div>

        <p className="text-[15px] font-bold leading-tight text-white">
          {hasNext ? (
            <>
              S{String(show.nextEpisode!.seasonNumber).padStart(2, "0")} | E
              {String(show.nextEpisode!.episodeNumber).padStart(2, "0")}
              {show.remaining > 0 && (
                <span className="text-sm font-semibold text-muted-foreground">
                  {" "}
                  +{show.remaining}
                </span>
              )}
            </>
          ) : (
            <span className="text-sm text-muted-foreground">Up to date</span>
          )}
        </p>

        {hasNext && show.nextEpisode!.title && (
          <p className="truncate text-[13px] leading-tight text-muted-foreground">
            {show.nextEpisode!.title}
          </p>
        )}
      </Link>

      {hasNext && (
        <MarkWatchedButton
          showTmdbId={show.tmdbId}
          seasonNumber={show.nextEpisode!.seasonNumber}
          episodeNumber={show.nextEpisode!.episodeNumber}
          onWatched={() => setDismissed(true)}
          onWatchFailed={() => setDismissed(false)}
        />
      )}
    </div>
  );
}
