/**
 * Generic embed-source registry for the native player's iframe fallback.
 *
 * Every entry is an iframe player that:
 *   - loads a stream from a movie/tv URL
 *   - posts PLAYER_EVENT messages (play/pause/seeked/ended/timeupdate) with
 *     currentTime/duration — the protocol our player bridge already consumes
 *
 * Adding a server = one entry here. No per-server player code.
 *
 * Integration status (2026-08-09):
 *   - vixsrc  : legacy, always-on fallback (existing code path, `src` prop)
 *   - vidfast : added, real domain is vidfast.vc (vidfast.pro is a 301 shell)
 *   - vidlink : added, movie-web resolver API
 *   - others  : same shape (superembed/vidzee/cinesrc/vidnest) — probe each
 *     before adding; fmovies.gd + primewire.mov are scraper sites, NOT clean
 *     embeds, likely need special handling.
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
  {
    key: "vidzee",
    name: "VidZee",
    base: "https://vidzee.wtf",
    host: "vidzee.wtf",
    movieUrl: (tmdbId) => `https://vidzee.wtf/movie/${tmdbId}`,
    tvUrl: (tmdbId, season, episode) =>
      `https://vidzee.wtf/tv/${tmdbId}/${season}/${episode}`,
  },
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
    key: "cinesrc",
    name: "CineSrc",
    base: "https://cinesrc.st",
    host: "cinesrc.st",
    movieUrl: (tmdbId) => `https://cinesrc.st/embed/movie/${tmdbId}`,
    // TV path shape not confirmed (all probed patterns 404) — leave movie-only
    // until a working tv shape is found; the player falls back to the next source.
    tvUrl: () => "",
  },
];

/** True for any registered embed host (and its subdomains). */
export function isEmbedPlayerOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
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

/** Label for a source key ("Vix" | "Goated" | registry names). */
export function sourceLabel(key: string): string {
  if (key === "vix") return "Vix";
  if (key === "goated") return "Goated";
  return EMBED_SOURCES.find((s) => s.key === key)?.name ?? key;
}
