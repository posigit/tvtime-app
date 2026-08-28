import { db, withDbRetry } from "./db";
import {
  movies,
  shows,
  surprisePool,
  userMovies,
  userShows,
} from "./schema";
import { getContinueWatching, type ContinueWatchingItem } from "./playback";
import { filterNewMedia } from "./recommend";
import {
  getOrBuildExploreDigest,
  getLibraryState,
  orderGenreChips,
  genreIdForName,
  type ExploreDigest,
} from "./explore-digest";
import { getTonightEpisodes, type TonightItem } from "./explore-tonight";
import {
  cachedAiringToday,
  cachedNowPlaying,
  cachedOnTheAir,
  cachedPopularTv,
  cachedTopRatedMovies,
  cachedTrendingMovies,
  cachedTrendingTv,
  cachedUpcoming,
  rankTopTen,
} from "./tmdb-list-cache";
import {
  MOVIE_GENRES,
  TV_GENRES,
  type TmdbMediaCard,
} from "./tmdb";
import {
  aggregateGenres,
  genresFromTmdbData,
} from "./profile-insights";
import { and, eq } from "drizzle-orm";
import type { GenreChipMeta } from "./explore-types";

export type { GenreChipMeta };

export type ExploreLibrary = {
  followedShowIds: Set<number>;
  movieStatusById: Map<number, string | null | undefined>;
  ownedMovieIds: Set<number>;
};

export type ExploreFeedData = {
  digest: ExploreDigest;
  continueWatching: ContinueWatchingItem[];
  tonight: TonightItem[];
  topShows: TmdbMediaCard[];
  topMovies: TmdbMediaCard[];
  library: ExploreLibrary;
};

export type ExploreDiscoverData = {
  hiddenGems: TmdbMediaCard[];
  hotMovies: TmdbMediaCard[];
  popularTv: TmdbMediaCard[];
  upcoming: TmdbMediaCard[];
  airingToday: TmdbMediaCard[];
  onTheAir: TmdbMediaCard[];
  nowPlaying: TmdbMediaCard[];
  topMovies: TmdbMediaCard[];
  genreChips: GenreChipMeta[];
  library: ExploreLibrary;
};

async function topTasteNames(userId: string): Promise<string[]> {
  try {
    const [showRows, movieRows] = await Promise.all([
      withDbRetry(() =>
        db
          .select({ tmdbData: shows.tmdbData })
          .from(userShows)
          .innerJoin(shows, eq(shows.tmdbId, userShows.tmdbId))
          .where(eq(userShows.userId, userId))
          .limit(40)
      ),
      withDbRetry(() =>
        db
          .select({ tmdbData: movies.tmdbData })
          .from(userMovies)
          .innerJoin(movies, eq(movies.tmdbId, userMovies.tmdbId))
          .where(
            and(eq(userMovies.userId, userId), eq(userMovies.status, "watched"))
          )
          .limit(40)
      ),
    ]);
    return aggregateGenres(
      [...showRows, ...movieRows].map((row) => ({
        genres: genresFromTmdbData(row.tmdbData),
        weight: 1,
        scoreSum: 0,
        scoreCount: 0,
      }))
    ).map((g) => g.name);
  } catch {
    return [];
  }
}

function defaultGenreChips(): GenreChipMeta[] {
  return [
    ...TV_GENRES.map((g) => ({
      key: `tv-${g.id}`,
      label: `TV · ${g.name}`,
      kind: "tv" as const,
      genreId: g.id,
    })),
    ...MOVIE_GENRES.map((g) => ({
      key: `movie-${g.id}`,
      label: `Film · ${g.name}`,
      kind: "movie" as const,
      genreId: g.id,
    })),
  ];
}

export async function loadExploreFeed(userId: string): Promise<ExploreFeedData> {
  const [digest, continueWatching, tonight, library, trendingTv, trendingMovies] =
    await Promise.all([
      getOrBuildExploreDigest(userId),
      getContinueWatching(userId, 8).catch(() => [] as ContinueWatchingItem[]),
      getTonightEpisodes(userId, 8),
      getLibraryState(userId),
      cachedTrendingTv("week").catch(() => [] as TmdbMediaCard[]),
      cachedTrendingMovies("week").catch(() => [] as TmdbMediaCard[]),
    ]);

  return {
    digest,
    continueWatching,
    tonight,
    topShows: rankTopTen(trendingTv, 10),
    topMovies: rankTopTen(trendingMovies, 10),
    library,
  };
}

export type TopTenKind = "shows" | "movies";

export async function loadTopTenChart(
  userId: string,
  kind: TopTenKind
): Promise<{
  kind: TopTenKind;
  items: TmdbMediaCard[];
  library: ExploreLibrary;
}> {
  const [library, raw] = await Promise.all([
    getLibraryState(userId),
    kind === "shows"
      ? cachedTrendingTv("week").catch(() => [] as TmdbMediaCard[])
      : cachedTrendingMovies("week").catch(() => [] as TmdbMediaCard[]),
  ]);
  return {
    kind,
    items: rankTopTen(raw, 10),
    library,
  };
}

export async function loadExploreDiscover(
  userId: string
): Promise<ExploreDiscoverData> {
  const library = await getLibraryState(userId);
  const { followedShowIds, ownedMovieIds } = library;

  const [
    gems,
    trendingMovies,
    popularTv,
    upcoming,
    airingToday,
    onTheAir,
    nowPlaying,
    topMovies,
    taste,
  ] = await Promise.all([
    withDbRetry(() => db.select().from(surprisePool)).catch(() => []),
    cachedTrendingMovies("week").catch(() => [] as TmdbMediaCard[]),
    cachedPopularTv().catch(() => [] as TmdbMediaCard[]),
    cachedUpcoming().catch(() => [] as TmdbMediaCard[]),
    cachedAiringToday().catch(() => [] as TmdbMediaCard[]),
    cachedOnTheAir().catch(() => [] as TmdbMediaCard[]),
    cachedNowPlaying().catch(() => [] as TmdbMediaCard[]),
    cachedTopRatedMovies().catch(() => [] as TmdbMediaCard[]),
    topTasteNames(userId),
  ]);

  const hiddenGems = filterNewMedia(
    gems.map((g) => ({
      id: g.tmdbId,
      title: g.title,
      poster_path: g.posterPath,
      mediaType: "movie" as const,
      vote_average: g.voteAverage ?? undefined,
      badge: g.badge ?? "Hidden gem",
    })),
    ownedMovieIds,
    16
  );

  const genreChips = orderGenreChips(defaultGenreChips(), taste);
  // Prefer a taste-matched chip first so Discover opens on something personal
  const preferred = taste
    .map((name) => {
      const tvId = genreIdForName(name, "tv");
      const movieId = genreIdForName(name, "movie");
      return (
        genreChips.find((c) => c.kind === "tv" && c.genreId === tvId) ||
        genreChips.find((c) => c.kind === "movie" && c.genreId === movieId)
      );
    })
    .find(Boolean);
  const ordered = preferred
    ? [preferred, ...genreChips.filter((c) => c.key !== preferred.key)]
    : genreChips;

  return {
    hiddenGems,
    hotMovies: filterNewMedia(trendingMovies, ownedMovieIds, 14),
    popularTv: filterNewMedia(popularTv, followedShowIds, 14),
    upcoming: filterNewMedia(upcoming, ownedMovieIds, 14),
    airingToday: filterNewMedia(airingToday, followedShowIds, 12),
    onTheAir: filterNewMedia(onTheAir, followedShowIds, 12),
    nowPlaying: filterNewMedia(nowPlaying, ownedMovieIds, 12),
    topMovies: filterNewMedia(topMovies, ownedMovieIds, 12),
    genreChips: ordered,
    library,
  };
}
