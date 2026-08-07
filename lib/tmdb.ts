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
  params: Record<string, string> = {},
  opts?: { revalidate?: number }
): Promise<T> {
  const url = new URL(`${TMDB_BASE_URL}${path}`);
  url.searchParams.append("api_key", getApiKey());
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));

  const res = await fetch(url.toString(), {
    // Default 1h; hot paths (trending) can pass a shorter window
    next: { revalidate: opts?.revalidate ?? 3600 },
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

export type TmdbCrewMember = {
  job?: string;
  department?: string;
  name?: string;
  id?: number;
};

export async function getMovieCredits(tmdbId: number) {
  return tmdbFetch<{
    id: number;
    cast: Array<{
      id: number;
      name: string;
      character?: string;
      order?: number;
      profile_path?: string | null;
    }>;
    crew: TmdbCrewMember[];
  }>(`/movie/${tmdbId}/credits`, {}, { revalidate: 86400 });
}

/** Director names from TMDB movie credits crew. */
export function movieDirectors(crew: TmdbCrewMember[] | null | undefined): string[] {
  if (!crew?.length) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const c of crew) {
    if (c.job !== "Director" || !c.name) continue;
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    names.push(c.name);
  }
  return names;
}

export async function getTvExternalIds(tmdbId: number) {
  return tmdbFetch<{ imdb_id?: string | null }>(`/tv/${tmdbId}/external_ids`);
}

export async function getMovieExternalIds(tmdbId: number) {
  return tmdbFetch<{ imdb_id?: string | null }>(`/movie/${tmdbId}/external_ids`);
}

export type TmdbVideo = {
  id: string;
  key: string;
  site?: string;
  type?: string;
  official?: boolean;
  name?: string;
  published_at?: string;
};

export async function getMovieVideos(tmdbId: number) {
  const data = await tmdbFetch<{ results: TmdbVideo[] }>(
    `/movie/${tmdbId}/videos`,
    {},
    { revalidate: 86400 }
  );
  return data.results ?? [];
}

export async function getTvVideos(tmdbId: number) {
  const data = await tmdbFetch<{ results: TmdbVideo[] }>(
    `/tv/${tmdbId}/videos`,
    {},
    { revalidate: 86400 }
  );
  return data.results ?? [];
}

/** Best YouTube trailer key: official Trailer first, then any Trailer, then Teaser. */
export function pickTrailerKey(videos: TmdbVideo[]): string | null {
  const yt = videos.filter((v) => v.site === "YouTube" && v.key);
  if (yt.length === 0) return null;
  const rank = (v: TmdbVideo) =>
    (v.type === "Trailer" ? 2 : v.type === "Teaser" ? 1 : 0) * 10 +
    (v.official ? 1 : 0);
  yt.sort((a, b) => rank(b) - rank(a));
  return yt[0].key;
}

export type TmdbReview = {
  id: string;
  author: string;
  content: string;
  url?: string;
  created_at?: string;
  updated_at?: string;
  author_details?: {
    name?: string;
    username?: string;
    avatar_path?: string | null;
    rating?: number | null;
  };
};

export async function getMovieReviews(tmdbId: number, page = 1) {
  return tmdbFetch<{
    id: number;
    page: number;
    results: TmdbReview[];
    total_pages: number;
    total_results: number;
  }>(`/movie/${tmdbId}/reviews`, { page: String(page) }, { revalidate: 3600 });
}

export async function getTvReviews(tmdbId: number, page = 1) {
  return tmdbFetch<{
    id: number;
    page: number;
    results: TmdbReview[];
    total_pages: number;
    total_results: number;
  }>(`/tv/${tmdbId}/reviews`, { page: String(page) }, { revalidate: 3600 });
}

/** Trending revalidates every 15m so Explore feels fresher. */
const TRENDING_REVALIDATE = 900;

export async function getTrendingTv(timeWindow: "day" | "week" = "week") {
  return tmdbFetch<{
    results: Array<{
      id: number;
      name: string;
      poster_path?: string;
      backdrop_path?: string;
      overview?: string;
      vote_average?: number;
    }>;
  }>(`/trending/tv/${timeWindow}`, {}, { revalidate: TRENDING_REVALIDATE });
}

export async function getTrendingMovies(timeWindow: "day" | "week" = "week") {
  return tmdbFetch<{
    results: Array<{
      id: number;
      title: string;
      poster_path?: string;
      backdrop_path?: string;
      overview?: string;
      vote_average?: number;
    }>;
  }>(`/trending/movie/${timeWindow}`, {}, { revalidate: TRENDING_REVALIDATE });
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

export type TmdbMediaCard = {
  id: number;
  title: string;
  poster_path?: string | null;
  mediaType: "tv" | "movie";
  vote_average?: number;
};

type TmdbListItem = {
  id: number;
  name?: string;
  title?: string;
  poster_path?: string | null;
  vote_average?: number;
};

function mapList(
  results: TmdbListItem[],
  mediaType: "tv" | "movie"
): TmdbMediaCard[] {
  return results.map((r) => ({
    id: r.id,
    title: (mediaType === "tv" ? r.name : r.title) || "Untitled",
    poster_path: r.poster_path,
    mediaType,
    vote_average: r.vote_average,
  }));
}

export async function getTvRecommendations(tmdbId: number) {
  const data = await tmdbFetch<{ results: TmdbListItem[] }>(
    `/tv/${tmdbId}/recommendations`
  );
  return mapList(data.results ?? [], "tv");
}

export async function getTvSimilar(tmdbId: number) {
  const data = await tmdbFetch<{ results: TmdbListItem[] }>(
    `/tv/${tmdbId}/similar`
  );
  return mapList(data.results ?? [], "tv");
}

export async function getMovieRecommendations(tmdbId: number) {
  const data = await tmdbFetch<{ results: TmdbListItem[] }>(
    `/movie/${tmdbId}/recommendations`
  );
  return mapList(data.results ?? [], "movie");
}

export async function getMovieSimilar(tmdbId: number) {
  const data = await tmdbFetch<{ results: TmdbListItem[] }>(
    `/movie/${tmdbId}/similar`
  );
  return mapList(data.results ?? [], "movie");
}

export async function getTopRatedTv() {
  const data = await tmdbFetch<{ results: TmdbListItem[] }>("/tv/top_rated");
  return mapList(data.results ?? [], "tv");
}

export async function getTopRatedMovies() {
  const data = await tmdbFetch<{ results: TmdbListItem[] }>("/movie/top_rated");
  return mapList(data.results ?? [], "movie");
}

export type TmdbMovieCard = TmdbMediaCard & {
  release_date?: string | null;
  overview?: string | null;
};

function mapMovieCards(
  results: Array<
    TmdbListItem & { release_date?: string; overview?: string }
  >
): TmdbMovieCard[] {
  return (results ?? []).map((r) => ({
    id: r.id,
    title: r.title || r.name || "Untitled",
    poster_path: r.poster_path,
    mediaType: "movie" as const,
    vote_average: r.vote_average,
    release_date: r.release_date ?? null,
    overview: r.overview ?? null,
  }));
}

/** Paginated top-rated movies (TMDB ~20 per page). */
export async function getTopRatedMoviesPage(page = 1): Promise<TmdbMovieCard[]> {
  const data = await tmdbFetch<{
    results: Array<
      TmdbListItem & { release_date?: string; overview?: string }
    >;
  }>("/movie/top_rated", { page: String(page) });
  return mapMovieCards(data.results ?? []);
}

/**
 * Highly rated "classics" — strong scores + real vote volume.
 * Optional max year biases toward older films when set.
 * `sortBy` rotates per week so different populations surface (vote avg,
 * popularity, revenue, vote count, release date) instead of the same
 * top-rated wall every single time.
 */
export async function discoverGreatMovies(
  page = 1,
  opts?: {
    maxYear?: number;
    minYear?: number;
    minVoteAverage?: number;
    minVoteCount?: number;
    maxVoteCount?: number;
    /** ISO 639-1 code(s), e.g. "ja" or "fr|ko" — for world-cinema slices */
    originalLanguage?: string;
    sortBy?:
      | "vote_average.desc"
      | "popularity.desc"
      | "revenue.desc"
      | "vote_count.desc"
      | "primary_release_date.desc";
    withGenres?: string;
  }
): Promise<TmdbMovieCard[]> {
  const maxYear = opts?.maxYear;
  const minVote = opts?.minVoteAverage ?? 7.5;
  const data = await tmdbFetch<{
    results: Array<
      TmdbListItem & { release_date?: string; overview?: string }
    >;
  }>("/discover/movie", {
    sort_by: opts?.sortBy ?? "vote_average.desc",
    "vote_count.gte": String(opts?.minVoteCount ?? 800),
    "vote_average.gte": String(minVote),
    ...(opts?.maxVoteCount
      ? { "vote_count.lte": String(opts.maxVoteCount) }
      : {}),
    ...(maxYear
      ? { "primary_release_date.lte": `${maxYear}-12-31` }
      : {}),
    ...(opts?.minYear
      ? { "primary_release_date.gte": `${opts.minYear}-01-01` }
      : {}),
    ...(opts?.originalLanguage
      ? { with_original_language: opts.originalLanguage }
      : {}),
    ...(opts?.withGenres ? { with_genres: opts.withGenres } : {}),
    page: String(page),
    include_adult: "false",
  });
  return mapMovieCards(data.results ?? []);
}

export async function getNowPlayingMovies() {
  const data = await tmdbFetch<{ results: TmdbListItem[] }>("/movie/now_playing");
  return mapList(data.results ?? [], "movie");
}

/** Movies opening soon (theatrical). */
export async function getUpcomingMovies() {
  const data = await tmdbFetch<{ results: TmdbListItem[] }>("/movie/upcoming");
  return mapList(data.results ?? [], "movie");
}

export async function getPopularTv() {
  const data = await tmdbFetch<{ results: TmdbListItem[] }>("/tv/popular");
  return mapList(data.results ?? [], "tv");
}

/** Higher-quality discover: min votes so junk is filtered out. */
export async function discoverTvPopular(
  opts: { withGenres?: number; page?: number } = {}
) {
  const data = await tmdbFetch<{ results: TmdbListItem[] }>("/discover/tv", {
    sort_by: "popularity.desc",
    "vote_count.gte": "50",
    ...(opts.withGenres != null
      ? { with_genres: String(opts.withGenres) }
      : {}),
    page: String(opts.page ?? 1),
  });
  return mapList(data.results ?? [], "tv");
}

export async function discoverMoviePopular(
  opts: { withGenres?: number; page?: number } = {}
) {
  const data = await tmdbFetch<{ results: TmdbListItem[] }>("/discover/movie", {
    sort_by: "popularity.desc",
    "vote_count.gte": "80",
    ...(opts.withGenres != null
      ? { with_genres: String(opts.withGenres) }
      : {}),
    page: String(opts.page ?? 1),
  });
  return mapList(data.results ?? [], "movie");
}

export async function discoverTvByGenre(genreId: number, page = 1) {
  const data = await tmdbFetch<{ results: TmdbListItem[] }>("/discover/tv", {
    with_genres: String(genreId),
    sort_by: "popularity.desc",
    page: String(page),
  });
  return mapList(data.results ?? [], "tv");
}

export async function discoverMoviesByGenre(genreId: number, page = 1) {
  const data = await tmdbFetch<{ results: TmdbListItem[] }>("/discover/movie", {
    with_genres: String(genreId),
    sort_by: "popularity.desc",
    page: String(page),
  });
  return mapList(data.results ?? [], "movie");
}

export type WatchProvider = {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
};

export type WatchProvidersResult = {
  link?: string;
  flatrate: WatchProvider[];
  rent: WatchProvider[];
  buy: WatchProvider[];
};

function mapProviders(
  list:
    | Array<{
        provider_id: number;
        provider_name: string;
        logo_path?: string | null;
      }>
    | undefined
): WatchProvider[] {
  return (list ?? []).map((p) => ({
    provider_id: p.provider_id,
    provider_name: p.provider_name,
    logo_path: p.logo_path ?? null,
  }));
}

/** Where to watch. Region from WATCH_REGION env (default US). */
export async function getWatchProviders(
  tmdbId: number,
  type: "tv" | "movie"
): Promise<WatchProvidersResult> {
  const region = (process.env.WATCH_REGION || "US").toUpperCase();
  const data = await tmdbFetch<{
    results?: Record<
      string,
      {
        link?: string;
        flatrate?: Array<{
          provider_id: number;
          provider_name: string;
          logo_path?: string | null;
        }>;
        rent?: Array<{
          provider_id: number;
          provider_name: string;
          logo_path?: string | null;
        }>;
        buy?: Array<{
          provider_id: number;
          provider_name: string;
          logo_path?: string | null;
        }>;
      }
    >;
  }>(`/${type}/${tmdbId}/watch/providers`);

  const entry = data.results?.[region] ?? data.results?.US;
  if (!entry) return { flatrate: [], rent: [], buy: [] };
  return {
    link: entry.link,
    flatrate: mapProviders(entry.flatrate),
    rent: mapProviders(entry.rent),
    buy: mapProviders(entry.buy),
  };
}

export function providerLogoUrl(path: string | null | undefined) {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE_URL}/w92${path}`;
}

export const TV_GENRES = [
  { id: 10765, name: "Sci-Fi & Fantasy" },
  { id: 80, name: "Crime" },
  { id: 18, name: "Drama" },
  { id: 35, name: "Comedy" },
  { id: 16, name: "Animation" },
  { id: 10759, name: "Action & Adventure" },
] as const;

export const MOVIE_GENRES = [
  { id: 28, name: "Action" },
  { id: 878, name: "Science Fiction" },
  { id: 80, name: "Crime" },
  { id: 18, name: "Drama" },
  { id: 35, name: "Comedy" },
  { id: 27, name: "Horror" },
] as const;
