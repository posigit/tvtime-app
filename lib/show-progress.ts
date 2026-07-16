export type EpisodeInfo = {
  showTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDate?: string | null;
  stillPath?: string | null;
};

export type WatchedKey = `${number}:${number}`;

export function makeWatchedKey(
  seasonNumber: number,
  episodeNumber: number
): WatchedKey {
  return `${seasonNumber}:${episodeNumber}`;
}

function isAired(airDate: string | null | undefined, today: Date): boolean {
  if (!airDate) return true;
  return new Date(airDate) <= today;
}

export function computeNextEpisode(
  episodes: EpisodeInfo[],
  lastWatched: { seasonNumber: number | null; episodeNumber: number | null },
  watchedKeys: Set<WatchedKey>
): { nextEpisode: EpisodeInfo | null; remaining: number } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sorted = [...episodes].sort((a, b) => {
    if (a.seasonNumber !== b.seasonNumber)
      return a.seasonNumber - b.seasonNumber;
    return a.episodeNumber - b.episodeNumber;
  });

  let nextEpisode: EpisodeInfo | null = null;
  let remaining = 0;

  for (const ep of sorted) {
    if (watchedKeys.has(makeWatchedKey(ep.seasonNumber, ep.episodeNumber)))
      continue;
    if (!isAired(ep.airDate, today)) continue;

    remaining++;

    if (!nextEpisode) {
      const isAfterLastWatched =
        !lastWatched.seasonNumber ||
        !lastWatched.episodeNumber ||
        ep.seasonNumber > lastWatched.seasonNumber ||
        (ep.seasonNumber === lastWatched.seasonNumber &&
          ep.episodeNumber > lastWatched.episodeNumber);
      if (isAfterLastWatched) {
        nextEpisode = ep;
      }
    }
  }

  if (!nextEpisode && remaining > 0) {
    nextEpisode = sorted.find(
      (ep) =>
        !watchedKeys.has(makeWatchedKey(ep.seasonNumber, ep.episodeNumber)) &&
        isAired(ep.airDate, today)
    )!;
  }

  return { nextEpisode, remaining };
}

export function computeUpcomingEpisodes(
  episodes: EpisodeInfo[],
  watchedKeys: Set<WatchedKey>
): EpisodeInfo[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return episodes
    .filter((ep) => {
      if (watchedKeys.has(makeWatchedKey(ep.seasonNumber, ep.episodeNumber)))
        return false;
      if (!ep.airDate) return false;
      return new Date(ep.airDate) <= today;
    })
    .sort(
      (a, b) =>
        new Date(b.airDate!).getTime() - new Date(a.airDate!).getTime()
    );
}
