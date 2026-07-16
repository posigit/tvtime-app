"use client";

import { useState } from "react";
import { EpisodeRow, EpisodeData } from "./episode-row";

export function SeasonEpisodeList({
  episodes,
  showTmdbId,
}: {
  episodes: EpisodeData[];
  showTmdbId: number;
}) {
  const [watchedMap, setWatchedMap] = useState<Record<number, boolean>>(() => {
    const map: Record<number, boolean> = {};
    for (const ep of episodes) {
      map[ep.episodeNumber] = ep.watched;
    }
    return map;
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [targetEpisode, setTargetEpisode] = useState<EpisodeData | null>(null);
  const [pending, setPending] = useState(false);

  const openDialog = (episode: EpisodeData) => {
    const previousUnwatched = episodes.filter(
      (ep) => ep.episodeNumber < episode.episodeNumber && !watchedMap[ep.episodeNumber]
    );
    if (previousUnwatched.length === 0) {
      return false;
    }
    setTargetEpisode(episode);
    setDialogOpen(true);
    return true;
  };

  const handleToggle = async (episode: EpisodeData, watched: boolean) => {
    if (watched && openDialog(episode)) {
      // Dialog will handle the actual API call if confirmed
      return;
    }

    setWatchedMap((prev) => ({ ...prev, [episode.episodeNumber]: watched }));
    await fetch("/api/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        showTmdbId,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        watched,
      }),
    });
  };

  const markPrevious = async () => {
    if (!targetEpisode) return;
    setPending(true);

    const items = episodes
      .filter(
        (ep) =>
          ep.episodeNumber <= targetEpisode.episodeNumber &&
          !watchedMap[ep.episodeNumber]
      )
      .map((ep) => ({
        showTmdbId,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
        watched: true,
      }));

    const nextMap = { ...watchedMap };
    for (const ep of episodes) {
      if (ep.episodeNumber <= targetEpisode.episodeNumber) {
        nextMap[ep.episodeNumber] = true;
      }
    }
    setWatchedMap(nextMap);
    setDialogOpen(false);

    try {
      await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodes: items }),
      });
    } catch (err) {
      // Revert on error
      setWatchedMap((prev) => {
        const reverted = { ...prev };
        for (const ep of episodes) {
          if (ep.episodeNumber <= targetEpisode.episodeNumber) {
            reverted[ep.episodeNumber] = episodes.find(
              (e) => e.episodeNumber === ep.episodeNumber
            )?.watched ?? false;
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
    ? episodes.filter(
        (ep) => ep.episodeNumber < targetEpisode.episodeNumber && !watchedMap[ep.episodeNumber]
      ).length
    : 0;

  return (
    <>
      <div className="mt-4 space-y-2">
        {episodes.map((ep) => (
          <EpisodeRow
            key={ep.episodeNumber}
            episode={{ ...ep, watched: watchedMap[ep.episodeNumber] ?? false }}
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
              You watched episode {targetEpisode.episodeNumber} but there are{" "}
              {previousCount} earlier unwatched episodes. Mark them as watched too?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setDialogOpen(false);
                  setTargetEpisode(null);
                }}
                disabled={pending}
                className="flex-1 rounded-full border border-white/20 py-3 text-sm font-medium text-white"
              >
                No
              </button>
              <button
                onClick={markPrevious}
                disabled={pending}
                className="flex-1 rounded-full bg-primary py-3 text-sm font-bold text-black"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
