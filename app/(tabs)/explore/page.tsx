import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userShows, userMovies } from "@/lib/schema";
import { eq } from "drizzle-orm";
import {
  getTrendingTv,
  getPopularMovies,
  getAiringToday,
  getOnTheAir,
  getTopRatedTv,
  getTopRatedMovies,
  getNowPlayingMovies,
  getPopularTv,
  getTrendingMovies,
  discoverTvByGenre,
  discoverMoviesByGenre,
  posterUrl,
  TV_GENRES,
  MOVIE_GENRES,
  type TmdbMediaCard,
} from "@/lib/tmdb";
import { getBecauseYouWatched, filterNewMedia } from "@/lib/recommend";
import { SearchBar } from "@/components/search-bar";
import { StickyChrome } from "@/components/sticky-chrome";
import { SectionLabel } from "@/components/section-label";
import { ExplorePills } from "@/components/explore-pills";
import { ExploreHero } from "@/components/explore-hero";
import { ShowFollowButton } from "@/components/show-follow-button";
import { MovieWatchButton } from "@/components/movie-watch-button";
import { DiscoverRail } from "@/components/discover-rail";
import {
  DiscoverGenreBrowser,
  type GenreChip,
} from "@/components/discover-genre-browser";
import Link from "next/link";
import Image from "next/image";

function PosterTile({
  title,
  posterPath,
  href,
  action,
}: {
  title: string;
  posterPath?: string | null;
  href: string;
  action: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg bg-card">
      <Link href={href}>
        <div style={{ aspectRatio: "2 / 3" }} className="relative bg-secondary">
          {posterPath ? (
            <Image
              src={posterUrl(posterPath, "w342") ?? ""}
              alt={title}
              fill
              sizes="(max-width: 768px) 33vw, 200px"
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
              {title}
            </div>
          )}
        </div>
      </Link>
      <div className="absolute right-1.5 top-1.5">{action}</div>
    </div>
  );
}

function GridSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-3">
        <SectionLabel>{label}</SectionLabel>
      </div>
      <div className="grid grid-cols-3 gap-2">{children}</div>
    </section>
  );
}

/**
 * Pull fresh (not-in-library) cards and mark them seen so later sections
 * don't repeat the same posters.
 */
function takeFresh(
  items: TmdbMediaCard[],
  owned: Set<number>,
  seen: Set<string>,
  limit: number
): TmdbMediaCard[] {
  const out: TmdbMediaCard[] = [];
  for (const item of items) {
    if (owned.has(item.id)) continue;
    const key = `${item.mediaType}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function toTvCards(
  results: Array<{
    id: number;
    name: string;
    poster_path?: string;
    vote_average?: number;
  }>
): TmdbMediaCard[] {
  return results.map((r) => ({
    id: r.id,
    title: r.name,
    poster_path: r.poster_path,
    mediaType: "tv" as const,
    vote_average: r.vote_average,
  }));
}

function toMovieCards(
  results: Array<{
    id: number;
    title: string;
    poster_path?: string;
    vote_average?: number;
  }>
): TmdbMediaCard[] {
  return results.map((r) => ({
    id: r.id,
    title: r.title,
    poster_path: r.poster_path,
    mediaType: "movie" as const,
    vote_average: r.vote_average,
  }));
}

export default async function ExplorePage() {
  const userId = await requireAuth();

  const [
    trendingDay,
    trendingWeek,
    trendingMoviesDay,
    popularMovies,
    popularTv,
    airingToday,
    onTheAir,
    topTv,
    topMovies,
    nowPlaying,
    becauseRails,
    followedShows,
    followedMovies,
  ] = await Promise.all([
    getTrendingTv("day").catch(() => ({ results: [] })),
    getTrendingTv("week").catch(() => ({ results: [] })),
    getTrendingMovies("day").catch(() => ({ results: [] })),
    getPopularMovies().catch(() => ({ results: [] })),
    getPopularTv().catch(() => [] as TmdbMediaCard[]),
    getAiringToday().catch(() => ({ results: [] })),
    getOnTheAir().catch(() => ({ results: [] })),
    getTopRatedTv().catch(() => [] as TmdbMediaCard[]),
    getTopRatedMovies().catch(() => [] as TmdbMediaCard[]),
    getNowPlayingMovies().catch(() => [] as TmdbMediaCard[]),
    getBecauseYouWatched(userId, 14).catch(() => []),
    db
      .select({ tmdbId: userShows.tmdbId })
      .from(userShows)
      .where(eq(userShows.userId, userId)),
    db
      .select({ tmdbId: userMovies.tmdbId, status: userMovies.status })
      .from(userMovies)
      .where(eq(userMovies.userId, userId)),
  ]);

  const followedShowIds = new Set(followedShows.map((s) => s.tmdbId));
  const movieStatusById = new Map(
    followedMovies.map((m) => [m.tmdbId, m.status] as const)
  );
  const ownedMovieIds = new Set(followedMovies.map((m) => m.tmdbId));

  // Prefetch genre chips for Discover (TMDB 1h cache)
  const [tvGenreLists, movieGenreLists] = await Promise.all([
    Promise.all(
      TV_GENRES.map(async (g) => {
        const raw = await discoverTvByGenre(g.id).catch(
          () => [] as TmdbMediaCard[]
        );
        return {
          key: `tv-${g.id}`,
          label: `TV · ${g.name}`,
          kind: "tv" as const,
          items: filterNewMedia(raw, followedShowIds, 18),
        } satisfies GenreChip;
      })
    ),
    Promise.all(
      MOVIE_GENRES.map(async (g) => {
        const raw = await discoverMoviesByGenre(g.id).catch(
          () => [] as TmdbMediaCard[]
        );
        return {
          key: `movie-${g.id}`,
          label: `Film · ${g.name}`,
          kind: "movie" as const,
          items: filterNewMedia(raw, ownedMovieIds, 18),
        } satisfies GenreChip;
      })
    ),
  ]);
  const genreChips: GenreChip[] = [...tvGenreLists, ...movieGenreLists];

  // ── Feed: personal → hot → movies → quality ────────────────────────────
  const seen = new Set<string>();

  // Hero: first trending-day show not already followed (fallback week / movie)
  const heroTv =
    trendingDay.results.find((s) => !followedShowIds.has(s.id)) ||
    trendingWeek.results.find((s) => !followedShowIds.has(s.id));
  const heroMovie = trendingMoviesDay.results.find(
    (m) => !ownedMovieIds.has(m.id)
  );

  const hero = heroTv
    ? {
        id: heroTv.id,
        title: heroTv.name,
        mediaType: "tv" as const,
        posterPath: heroTv.poster_path,
        backdropPath: heroTv.backdrop_path,
        overview: heroTv.overview,
        badge: "Trending today",
      }
    : heroMovie
      ? {
          id: heroMovie.id,
          title: heroMovie.title,
          mediaType: "movie" as const,
          posterPath: heroMovie.poster_path,
          backdropPath: heroMovie.backdrop_path,
          overview: heroMovie.overview,
          badge: "Trending today",
        }
      : null;

  if (hero) seen.add(`${hero.mediaType}:${hero.id}`);

  // Mark because-you-watched items as seen so later rails don't repeat
  for (const rail of becauseRails) {
    for (const item of rail.items) {
      seen.add(`${item.mediaType}:${item.id}`);
    }
  }

  const trendingFresh = takeFresh(
    [
      ...toTvCards(trendingDay.results),
      ...toTvCards(trendingWeek.results),
    ],
    followedShowIds,
    seen,
    14
  );

  const airingFresh = takeFresh(
    toTvCards(airingToday.results),
    followedShowIds,
    seen,
    12
  );

  const popularTvFresh = takeFresh(popularTv, followedShowIds, seen, 12);

  const popularMoviesFresh = takeFresh(
    toMovieCards(popularMovies.results),
    ownedMovieIds,
    seen,
    12
  );

  const nowPlayingFresh = takeFresh(nowPlaying, ownedMovieIds, seen, 12);
  const topTvFresh = takeFresh(topTv, followedShowIds, seen, 12);
  const topMoviesFresh = takeFresh(topMovies, ownedMovieIds, seen, 12);

  const feed = (
    <>
      {hero && (
        <ExploreHero
          item={hero}
          following={
            hero.mediaType === "tv"
              ? followedShowIds.has(hero.id)
              : undefined
          }
          movieStatus={
            hero.mediaType === "movie"
              ? movieStatusById.get(hero.id) || null
              : undefined
          }
        />
      )}

      {becauseRails.length > 0 ? (
        becauseRails.map((rail) => (
          <DiscoverRail
            key={rail.seedTitle}
            label={`Because you watched ${rail.seedTitle}`}
            items={rail.items}
            followedShowIds={followedShowIds}
            movieStatusById={movieStatusById}
          />
        ))
      ) : (
        <p className="mb-5 text-center text-xs text-muted-foreground">
          Rate shows and movies to unlock personal picks here.
        </p>
      )}

      <DiscoverRail
        label="Trending now"
        items={trendingFresh}
        followedShowIds={followedShowIds}
        movieStatusById={movieStatusById}
      />

      <DiscoverRail
        label="Airing today"
        items={airingFresh}
        followedShowIds={followedShowIds}
        movieStatusById={movieStatusById}
      />

      <DiscoverRail
        label="Popular TV"
        items={popularTvFresh}
        followedShowIds={followedShowIds}
        movieStatusById={movieStatusById}
      />

      <DiscoverRail
        label="Popular movies"
        items={popularMoviesFresh}
        followedShowIds={followedShowIds}
        movieStatusById={movieStatusById}
      />

      <DiscoverRail
        label="In theaters"
        items={nowPlayingFresh}
        followedShowIds={followedShowIds}
        movieStatusById={movieStatusById}
      />

      <DiscoverRail
        label="Critically acclaimed TV"
        items={topTvFresh}
        followedShowIds={followedShowIds}
        movieStatusById={movieStatusById}
      />

      <DiscoverRail
        label="Critically acclaimed movies"
        items={topMoviesFresh}
        followedShowIds={followedShowIds}
        movieStatusById={movieStatusById}
      />
    </>
  );

  // Discover: browse by genre + denser grids for scanning
  const discoverAiring = filterNewMedia(
    toTvCards(airingToday.results),
    followedShowIds,
    9
  );
  const discoverOnAir = filterNewMedia(
    toTvCards(onTheAir.results),
    followedShowIds,
    9
  );
  const discoverPopularMovies = filterNewMedia(
    toMovieCards(popularMovies.results),
    ownedMovieIds,
    9
  );

  const discover = (
    <>
      <DiscoverGenreBrowser genres={genreChips} />

      {discoverAiring.length > 0 && (
        <GridSection label="Airing Today">
          {discoverAiring.map((show) => (
            <PosterTile
              key={show.id}
              title={show.title}
              posterPath={show.poster_path}
              href={`/show/${show.id}`}
              action={
                <ShowFollowButton
                  tmdbId={show.id}
                  initialFollowing={followedShowIds.has(show.id)}
                  variant="overlay"
                />
              }
            />
          ))}
        </GridSection>
      )}

      {discoverOnAir.length > 0 && (
        <GridSection label="On The Air">
          {discoverOnAir.map((show) => (
            <PosterTile
              key={show.id}
              title={show.title}
              posterPath={show.poster_path}
              href={`/show/${show.id}`}
              action={
                <ShowFollowButton
                  tmdbId={show.id}
                  initialFollowing={followedShowIds.has(show.id)}
                  variant="overlay"
                />
              }
            />
          ))}
        </GridSection>
      )}

      {discoverPopularMovies.length > 0 && (
        <GridSection label="Popular Movies">
          {discoverPopularMovies.map((movie) => (
            <PosterTile
              key={movie.id}
              title={movie.title}
              posterPath={movie.poster_path}
              href={`/movie/${movie.id}`}
              action={
                <MovieWatchButton
                  tmdbId={movie.id}
                  initialStatus={movieStatusById.get(movie.id) || null}
                  variant="overlay"
                />
              }
            />
          ))}
        </GridSection>
      )}
    </>
  );

  return (
    <div className="min-h-dvh bg-black pb-nav-page">
      <StickyChrome contentClassName="px-4 pt-3 pb-1">
        <SearchBar />
      </StickyChrome>
      <div className="px-4 pt-1">
        <ExplorePills feed={feed} discover={discover} />
      </div>
    </div>
  );
}
