/**
 * Embed-source registry for the player's iframe fallback.
 *
 * Picker order: vidnest, mapple, cinesrc, 2embed, vidfast, vidlink.
 * Native vix + goated are appended in vix-player (goated last, disabled).
 * Mapple is movie-only (empty tvUrl). CineSrc posts cinesrc:* events, not
 * PLAYER_EVENT — vix-player adapts those. CineSrc embeds use controls=false
 * so lock mode cannot leak its Vidstack chrome (host chrome + postMessage).
 */
export type EmbedSourceDef = {
  /** Stable key — persisted as preferredSource. */
  key: string;
  /** Display name for the picker. */
  name: string;
  /** Base origin, e.g. https://vidfast.vc */
  base: string;
  /** Hostname the player frames post messages from. */
  host: string;
  /** Build a movie embed URL. */
  movieUrl: (tmdbId: number) => string;
  /** Build a TV embed URL. */
  tvUrl: (tmdbId: number, season: number, episode: number) => string;
};

export const EMBED_SOURCES: EmbedSourceDef[] = [
  {
    key: "vidnest",
    name: "VidNest",
    base: "https://vidnest.fun",
    host: "vidnest.fun",
    movieUrl: (tmdbId) => `https://vidnest.fun/movie/${tmdbId}`,
    tvUrl: (tmdbId, season, episode) =>
      `https://vidnest.fun/tv/${tmdbId}/${season}/${episode}`,
  },
  {
    key: "mapple",
    name: "Mapple",
    base: "https://mapple.tv",
    host: "mapple.tv",
    movieUrl: (tmdbId) => `https://mapple.tv/movie/${tmdbId}`,
    // Movie-only — empty tvUrl disables this key on TV in the picker.
    tvUrl: () => "",
  },
  {
    key: "cinesrc",
    name: "CineSrc",
    base: "https://cinesrc.st",
    host: "cinesrc.st",
    movieUrl: (tmdbId) =>
      `https://cinesrc.st/embed/movie/${tmdbId}?controls=false`,
    // TV is query-string; posts cinesrc:* events (adapted in vix-player).
    tvUrl: (tmdbId, season, episode) =>
      `https://cinesrc.st/embed/tv/${tmdbId}?s=${season}&e=${episode}&controls=false`,
  },
  {
    key: "2embed",
    name: "2Embed",
    base: "https://www.2embed.cc",
    host: "2embed.cc",
    // /embed/ is the player; /movie/{id} is a wrapper landing page.
    movieUrl: (tmdbId) => `https://www.2embed.cc/embed/${tmdbId}`,
    tvUrl: (tmdbId, season, episode) =>
      `https://www.2embed.cc/embedtv/${tmdbId}&s=${season}&e=${episode}`,
  },
  {
    key: "vidfast",
    name: "VidFast",
    base: "https://vidfast.vc",
    host: "vidfast.vc",
    movieUrl: (tmdbId) => `https://vidfast.vc/movie/${tmdbId}?autoPlay=true&title=true&poster=true`,
    tvUrl: (tmdbId, season, episode) =>
      `https://vidfast.vc/tv/${tmdbId}/${season}/${episode}?autoPlay=true&title=true&poster=true&nextButton=true&autoNext=true`,
  },
  {
    key: "vidlink",
    name: "VidLink",
    base: "https://vidlink.pro",
    host: "vidlink.pro",
    movieUrl: (tmdbId) => `https://vidlink.pro/movie/${tmdbId}?autoplay=true&title=true&poster=true`,
    tvUrl: (tmdbId, season, episode) =>
      `https://vidlink.pro/tv/${tmdbId}/${season}/${episode}?autoplay=true&title=true&poster=true&nextbutton=true`,
  },
];

/** Origins that must keep accepting PLAYER_EVENT: the vixsrc iframe fallback
 *  plus vidfast's documented mirror hosts (dropping any kills progress). */
const LEGACY_PLAYER_ORIGINS = [
  "vixsrc.to",
  "vidfast.pro",
  "vidfast.in",
  "vidfast.io",
  "vidfast.me",
  "vidfast.net",
  "vidfast.pm",
  "vidfast.vc",
  "vidfast.xyz",
  "vidfast.bz",
];
export function isEmbedPlayerOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    if (
      LEGACY_PLAYER_ORIGINS.some(
        (h) => url.hostname === h || url.hostname.endsWith(`.${h}`)
      )
    ) {
      return true;
    }
    return EMBED_SOURCES.some(
      (s) =>
        url.hostname === s.host || url.hostname.endsWith(`.${s.host}`)
    );
  } catch {
    return false;
  }
}

/** Build an embed URL for a source key (null when not an embed source or
 *  the source has no URL for this media shape — e.g. movie-only embeds). */
export function embedUrlFor(
  key: string,
  type: "movie" | "tv",
  tmdbId: number,
  season?: number,
  episode?: number
): string | null {
  const src = EMBED_SOURCES.find((s) => s.key === key);
  if (!src) return null;
  let url: string | null = null;
  if (type === "movie") url = src.movieUrl(tmdbId);
  else if (season != null && episode != null) url = src.tvUrl(tmdbId, season, episode);
  return url ? url : null;
}

export const CINESRC_ORIGIN = "https://cinesrc.st";

export function sendCineSrcCommand(
  iframe: HTMLIFrameElement | null,
  command: string,
  args: unknown[] = []
): void {
  iframe?.contentWindow?.postMessage(
    { type: "cinesrc:command", command, args },
    CINESRC_ORIGIN
  );
}

/** Label for a source key ("Vix" | "Goated" | registry names). */
export function sourceLabel(key: string): string {
  if (key === "vix") return "Vix";
  if (key === "goated") return "Goated";
  return EMBED_SOURCES.find((s) => s.key === key)?.name ?? key;
}
