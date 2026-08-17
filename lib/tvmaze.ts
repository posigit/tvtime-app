/**
 * Minimal TVMaze client — no API key required.
 * Used to correct Apple TV+ air dates that TMDB records one day early
 * (TMDB uses the Pacific date; Apple's official date is the Eastern date).
 */

const TVMAZE_BASE = "https://api.tvmaze.com";
const UA = "tvtime-app/1.0 (airdate correction)";

export type TvmazeEpisode = {
  season: number;
  number: number;
  name: string;
  /** Civil date the episode officially airs (YYYY-MM-DD), Eastern/network date. */
  airdate: string | null;
  /** Full UTC timestamp of the unlock moment. */
  airstamp: string | null;
};

export type TvmazeShow = {
  id: number;
  name: string;
  network: string | null;
  premiered: string | null;
};

async function tvmazeFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${TVMAZE_BASE}${path}`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error(`TVMaze 404: ${path}`);
    throw new Error(`TVMaze error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** Find a show by title + year (when known). Returns null when absent. */
export async function searchTvmazeShow(
  title: string,
  year?: string | null
): Promise<TvmazeShow | null> {
  try {
    const params = new URLSearchParams({ q: title });
    if (year && /^\d{4}$/.test(year)) params.set("year", year);
    const show = await tvmazeFetch<{
      id: number;
      name: string;
      network: { name: string } | null;
      webChannel: { name: string } | null;
      premiered: string | null;
    }>(`/singlesearch/shows?${params.toString()}`);
    return {
      id: show.id,
      name: show.name,
      network: show.network?.name ?? show.webChannel?.name ?? null,
      premiered: show.premiered,
    };
  } catch {
    return null;
  }
}

/** All episodes for a show, newest-last (same order TVMaze returns). */
export async function getTvmazeEpisodes(
  showId: number
): Promise<TvmazeEpisode[]> {
  const eps = await tvmazeFetch<
    Array<{
      season: number;
      number: number | null;
      name: string;
      airdate: string | null;
      airstamp: string | null;
    }>
  >(`/shows/${showId}/episodes`);
  return eps
    .filter((e) => e.number != null)
    .map((e) => ({
      season: e.season,
      number: e.number as number,
      name: e.name,
      airdate: e.airdate ?? null,
      airstamp: e.airstamp ?? null,
    }));
}

/**
 * Map of "season:episode" → airdate for a show, or null when the show
 * can't be found / has no episodes.
 */
export async function getTvmazeAirdateMap(
  title: string,
  year?: string | null
): Promise<Map<string, string> | null> {
  const show = await searchTvmazeShow(title, year);
  if (!show) return null;
  const eps = await getTvmazeEpisodes(show.id);
  const map = new Map<string, string>();
  for (const e of eps) {
    if (e.airdate) map.set(`${e.season}:${e.number}`, e.airdate);
  }
  return map.size > 0 ? map : null;
}

/** True when a show's network list includes Apple TV+. */
export function isAppleTv(networks: string[] | null | undefined): boolean {
  if (!networks || networks.length === 0) return false;
  return networks.some((n) => /apple/i.test(n));
}
