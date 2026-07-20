const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";

function getApiKey() {
  const key = process.env.TMDB_API_KEY;
  if (!key) {
    throw new Error("TMDB_API_KEY is not set");
  }
  return key;
}

async function tmdbFetch<T>(
  path: string,
  params: Record<string, string> = {}
): Promise<T> {
  const url = new URL(`${TMDB_BASE_URL}${path}`);
  url.searchParams.append("api_key", getApiKey());
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));

  const res = await fetch(url.toString(), {
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`TMDB API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function posterUrl(
  path: string | null | undefined,
  size: "w92" | "w154" | "w185" | "w342" | "w500" | "w780" | "original" = "w500"
) {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE_URL}/${size}${path}`;
}

export function backdropUrl(
  path: string | null | undefined,
  size: "w300" | "w780" | "w1280" | "original" = "w1280"
) {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE_URL}/${size}${path}`;
}

export function stillUrl(
  path: string | null | undefined,
  size: "w92" | "w185" | "w300" | "original" = "w300"
) {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE_URL}/${size}${path}`;
}

export async function searchTv(query: string, page = 1) {
  return tmdbFetch<{
    page: number;
    results: Array<{
      id: number;
      name: string;
      first_air_date?: string;
      poster_path?: string;
      overview?: string;
      popularity?: number;
    }>;
    total_pages: number;
    total_results: number;
  }>("/search/tv", { query, page: page.toString() });
}

export async function searchMovie(query: string, page = 1) {
  return tmdbFetch<{
    page: number;
    results: Array<{
      id: number;
      title: string;
      release_date?: string;
      poster_path?: string;
      overview?: string;
      popularity?: number;
    }>;
    total_pages: number;
    total_results: number;
  }>("/search/movie", { query, page: page.toString() });
}

export async function getTvDetails(tmdbId: number) {
  return tmdbFetch<{
    id: number;
    name: string;
    overview?: string;
    poster_path?: string;
    backdrop_path?: string;
    first_air_date?: string;
    last_air_date?: string;
    status?: string;
    networks?: Array<{ name: string }>;
    number_of_seasons?: number;
    number_of_episodes?: number;
    episode_run_time?: number[];
    vote_average?: number;
  }>(`/tv/${tmdbId}`);
}

export async function getTvSeason(tmdbId: number, seasonNumber: number) {
  return tmdbFetch<{
    id: number;
    name: string;
    season_number: number;
    episodes: Array<{
      id: number;
      name: string;
      overview?: string;
      episode_number: number;
      season_number: number;
      still_path?: string;
      air_date?: string;
      runtime?: number;
    }>;
  }>(`/tv/${tmdbId}/season/${seasonNumber}`);
}

export async function getMovieDetails(tmdbId: number) {
  return tmdbFetch<{
    id: number;
    title: string;
    overview?: string;
    poster_path?: string;
    backdrop_path?: string;
    release_date?: string;
    runtime?: number;
    status?: string;
    vote_average?: number;
  }>(`/movie/${tmdbId}`);
}

export async function getTvExternalIds(tmdbId: number) {
  return tmdbFetch<{ imdb_id?: string | null }>(`/tv/${tmdbId}/external_ids`);
}

export async function getMovieExternalIds(tmdbId: number) {
  return tmdbFetch<{ imdb_id?: string | null }>(`/movie/${tmdbId}/external_ids`);
}

export async function getTrendingTv(timeWindow: "day" | "week" = "week") {
  return tmdbFetch<{
    results: Array<{
      id: number;
      name: string;
      poster_path?: string;
      backdrop_path?: string;
    }>;
  }>(`/trending/tv/${timeWindow}`);
}

export async function getPopularMovies() {
  return tmdbFetch<{
    results: Array<{
      id: number;
      title: string;
      poster_path?: string;
      backdrop_path?: string;
    }>;
  }>("/movie/popular");
}

export async function getAiringToday() {
  return tmdbFetch<{
    results: Array<{
      id: number;
      name: string;
      poster_path?: string;
      backdrop_path?: string;
    }>;
  }>("/tv/airing_today");
}

export async function getOnTheAir() {
  return tmdbFetch<{
    results: Array<{
      id: number;
      name: string;
      poster_path?: string;
      backdrop_path?: string;
      first_air_date?: string;
    }>;
  }>("/tv/on_the_air");
}
