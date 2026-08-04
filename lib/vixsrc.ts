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

/** True for https://vixsrc.to and any https://*.vixsrc.to player frame. */
export function isVixPlayerOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" &&
      (url.hostname === "vixsrc.to" || url.hostname.endsWith(".vixsrc.to"))
    );
  } catch {
    return false;
  }
}

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
  return parseVixPlayerEventData(data)?.event ?? null;
}

export type VixPlayerEventData = {
  event: VixPlayerEvent;
  currentTime?: number;
  duration?: number;
};

function readNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : undefined;
}

/** Like parseVixPlayerEvent but also surfaces currentTime/duration (resume saves). */
export function parseVixPlayerEventData(
  data: unknown
): VixPlayerEventData | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as {
    type?: string;
    data?: {
      event?: string;
      currentTime?: number;
      duration?: number;
      // Some embed builds nest time under `data` differently.
      time?: number;
    };
    event?: string | {
      event?: string;
      currentTime?: number;
      duration?: number;
      time?: number;
    };
    currentTime?: number;
    duration?: number;
  };
  if (obj.type !== "PLAYER_EVENT") return null;

  // The vixsite /tv/... page (our iframe fallback) re-wraps the embed's
  // PLAYER_EVENT payload as `event` (not `data`), e.g.
  // { type:"PLAYER_EVENT", event:{ event, currentTime, duration } }.
  const payload: {
    event?: unknown;
    currentTime?: number;
    duration?: number;
    time?: number;
  } =
    obj.data && typeof obj.data === "object"
      ? obj.data
      : obj.event && typeof obj.event === "object"
        ? obj.event
        : obj;
  const event = typeof payload.event === "string"
    ? payload.event
    : typeof obj.event === "string"
      ? obj.event
      : null;
  if (
    typeof event !== "string" ||
    !(VIX_PLAYER_EVENTS as readonly string[]).includes(event)
  ) {
    return null;
  }
  return {
    event: event as VixPlayerEvent,
    currentTime:
      readNonNegativeNumber(payload.currentTime) ??
      readNonNegativeNumber(payload.time) ??
      readNonNegativeNumber(obj.currentTime),
    duration:
      readNonNegativeNumber(payload.duration) ??
      readNonNegativeNumber(obj.duration),
  };
}
