/**
 * VixSrc streaming embeds.
 *
 * Docs: https://vixsrc.to (Next generation Streaming API).
 * Movie embed:  https://vixsrc.to/movie/{tmdb_id|imdb_id}
 * Episode embed: https://vixsrc.to/tv/{tmdb_id|imdb_id}/{seasonNumber}/{episodeNumber}
 * Optional query params: lang=it (preferred audio), autoplay, startAt,
 * primaryColor, secondaryColor.
 */
export const VIX_BASE = "https://vixsrc.to";
export const VIX_PLAYER_ORIGIN = "https://vixsrc.to";
const VIX_PRIMARY_COLOR = "F5C518";
const VIX_SECONDARY_COLOR = "2C2C2E";

/** Default audio-language preference for embeds (user-provided `lang=it`). */
export const VIX_LANG = "en";

const VIX_PLAYER_EVENTS = [
  "play",
  "pause",
  "seeked",
  "ended",
  "timeupdate",
] as const;

export type VixPlayerEvent = (typeof VIX_PLAYER_EVENTS)[number];

export function vixMovieUrl(tmdbId: number) {
  return `${VIX_BASE}/movie/${tmdbId}?primaryColor=${VIX_PRIMARY_COLOR}&secondaryColor=${VIX_SECONDARY_COLOR}&autoplay=true&lang=${VIX_LANG}`;
}

export function vixTvUrl(
  tmdbId: number,
  seasonNumber: number,
  episodeNumber: number
) {
  return `${VIX_BASE}/tv/${tmdbId}/${seasonNumber}/${episodeNumber}?primaryColor=${VIX_PRIMARY_COLOR}&secondaryColor=${VIX_SECONDARY_COLOR}&autoplay=true&lang=${VIX_LANG}`;
}

export function parseVixPlayerEvent(data: unknown): VixPlayerEvent | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as { type?: string; data?: { event?: string } };
  if (obj.type !== "PLAYER_EVENT") return null;

  const event = obj.data?.event;
  return typeof event === "string" &&
    (VIX_PLAYER_EVENTS as readonly string[]).includes(event)
    ? (event as VixPlayerEvent)
    : null;
}

export type VixPlayerEventData = {
  event: VixPlayerEvent;
  currentTime?: number;
  duration?: number;
};

/** Like parseVixPlayerEvent but also surfaces currentTime/duration (resume saves). */
export function parseVixPlayerEventData(
  data: unknown
): VixPlayerEventData | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as {
    type?: string;
    data?: { event?: string; currentTime?: number; duration?: number };
  };
  if (obj.type !== "PLAYER_EVENT") return null;

  const event = obj.data?.event;
  if (
    typeof event !== "string" ||
    !(VIX_PLAYER_EVENTS as readonly string[]).includes(event)
  ) {
    return null;
  }
  return {
    event: event as VixPlayerEvent,
    currentTime:
      typeof obj.data?.currentTime === "number" &&
      Number.isFinite(obj.data.currentTime) &&
      obj.data.currentTime >= 0
        ? obj.data.currentTime
        : undefined,
    duration:
      typeof obj.data?.duration === "number" &&
      Number.isFinite(obj.data.duration) &&
      obj.data.duration >= 0
        ? obj.data.duration
        : undefined,
  };
}
