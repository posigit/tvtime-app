"use client";

import { useState } from "react";
import { EpisodeRow, EpisodeData } from "./episode-row";
import {
  compareEpisodeOrder,
  isEpisodeAired,
} from "@/lib/show-progress";

function watchKey(seasonNumber: number, episodeNumber: number) {
  return `${seasonNumber}:${episodeNumber}`;
}

export function SeasonEpisodeList({
  episodes,
  allEpisodes,
  showTmdbId,
}: {
  /** Episodes for the currently selected season (UI list). */
  episodes: EpisodeData[];
  /**
   * All seasons' episodes for this show — used so "Mark previous" can cover
   * S1E1 … S{n}E{m}, not only the current season.
   */
  allEpisodes: EpisodeData[];
  showTmdbId: number;
}) {
  const [watchedMap, setWatchedMap] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const ep of allEpisodes) {
      map[watchKey(ep.seasonNumber, ep.episodeNumber)] = ep.watched;
    }
    return map;
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [targetEpisode, setTargetEpisode] = useState<EpisodeData | null>(null);
  const [pending, setPending] = useState(false);

  const isWatched = (ep: EpisodeData) =>
    watchedMap[watchKey(ep.seasonNumber, ep.episodeNumber)] ?? false;

  /** All earlier episodes (any season) that are aired and still unwatched. */
  const getPreviousUnwatchedAired = (episode: EpisodeData) =>
    allEpisodes.filter(
      (ep) =>
        compareEpisodeOrder(ep, episode) < 0 &&
        !isWatched(ep) &&
        isEpisodeAired(ep.airDate)
    );

  const openDialog = (episode: EpisodeData) => {
    if (getPreviousUnwatchedAired(episode).length === 0) {
      return false;
    }
    setTargetEpisode(episode);
    setDialogOpen(true);
    return true;
  };

  const postWatch = async (
    items: {
      showTmdbId: number;
      seasonNumber: number;
      episodeNumber: number;
      watched: boolean;
    }[]
  ) => {
    const res = await fetch("/api/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        items.length === 1 ? items[0] : { episodes: items }
      ),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to update watch status");
    }
  };

  const markSingle = async (episode: EpisodeData, watched: boolean) => {
    if (watched && !isEpisodeAired(episode.airDate)) {
      return;
    }

    const key = watchKey(episode.seasonNumber, episode.episodeNumber);
    setWatchedMap((prev) => ({ ...prev, [key]: watched }));

    try {
      await postWatch([
        {
          showTmdbId,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          watched,
        },
      ]);
    } catch {
      setWatchedMap((prev) => ({
        ...prev,
        [key]: episode.watched,
      }));
    }
  };

  const handleToggle = async (episode: EpisodeData, watched: boolean) => {
    if (watched && !isEpisodeAired(episode.airDate)) {
      return;
    }

    if (watched && openDialog(episode)) {
      // Dialog will mark single or range
      return;
    }

    await markSingle(episode, watched);
  };

  const markJustTarget = async () => {
    if (!targetEpisode) return;
    setPending(true);
    setDialogOpen(false);
    try {
      await markSingle(targetEpisode, true);
    } finally {
      setPending(false);
      setTargetEpisode(null);
    }
  };

  const markPrevious = async () => {
    if (!targetEpisode) return;
    if (!isEpisodeAired(targetEpisode.airDate)) {
      setDialogOpen(false);
      setTargetEpisode(null);
      return;
    }

    setPending(true);

    // S1E1 … target (inclusive), aired only, currently unwatched
    const items = allEpisodes
      .filter(
        (ep) =>
          compareEpisodeOrder(ep, targetEpisode) <= 0 &&
          !isWatched(ep) &&
          isEpisodeAired(ep.airDate)
      )
      .map((ep) => ({
        showTmdbId,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
        watched: true as const,
      }));

    const nextMap = { ...watchedMap };
    for (const item of items) {
      nextMap[watchKey(item.seasonNumber, item.episodeNumber)] = true;
    }
    setWatchedMap(nextMap);
    setDialogOpen(false);

    try {
      if (items.length > 0) {
        await postWatch(items);
      }
    } catch {
      // Revert optimistic updates for this batch
      setWatchedMap((prev) => {
        const reverted = { ...prev };
        for (const ep of allEpisodes) {
          if (compareEpisodeOrder(ep, targetEpisode) <= 0) {
            reverted[watchKey(ep.seasonNumber, ep.episodeNumber)] = ep.watched;
          }
        }
        return reverted;
      });
    } finally {
      setPending(false);
      setTargetEpisode(null);
    }
  };

  const previousCount = targetEpisode
    ? getPreviousUnwatchedAired(targetEpisode).length
    : 0;

  const previousLabel =
    targetEpisode && previousCount > 0
      ? (() => {
          const prev = getPreviousUnwatchedAired(targetEpisode);
          const first = prev[0];
          return first
            ? `from S${first.seasonNumber}E${first.episodeNumber} through S${targetEpisode.seasonNumber}E${targetEpisode.episodeNumber}`
            : "";
        })()
      : "";

  return (
    <>
      <div className="mt-4 space-y-2">
        {episodes.map((ep) => (
          <EpisodeRow
            key={`${ep.seasonNumber}-${ep.episodeNumber}`}
            episode={{
              ...ep,
              watched: isWatched(ep),
            }}
            showTmdbId={showTmdbId}
            onToggle={(watched) => handleToggle(ep, watched)}
          />
        ))}
        {episodes.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No episode data for this season
          </p>
        )}
      </div>

      {dialogOpen && targetEpisode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6">
            <p className="mb-2 text-lg font-bold text-white">
              Mark previous episodes?
            </p>
            <p className="mb-6 text-sm text-muted-foreground">
              You&apos;re marking S{targetEpisode.seasonNumber}E
              {targetEpisode.episodeNumber}, but there {previousCount === 1 ? "is" : "are"}{" "}
              {previousCount} earlier unwatched episode
              {previousCount === 1 ? "" : "s"}
              {previousLabel ? ` (${previousLabel})` : ""}. Mark them as watched
              too? Only episodes that have already aired will be marked.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={markJustTarget}
                disabled={pending}
                className="flex-1 rounded-full border border-white/20 py-3 text-sm font-medium text-white"
              >
                Just this one
              </button>
              <button
                type="button"
                onClick={markPrevious}
                disabled={pending}
                className="flex-1 rounded-full bg-primary py-3 text-sm font-bold text-black"
              >
                Yes, mark all
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
