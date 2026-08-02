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
  getTrendingMovies,
  discoverTvByGenre,
  discoverMoviesByGenre,
  posterUrl,
  TV_GENRES,
  MOVIE_GENRES,
  type TmdbMediaCard,
} from "@/lib/tmdb";
import {
  getBecauseYouWatched,
  filterNewMedia,
  pickRotated,
  rotationOffset,
} from "@/lib/recommend";
import { SearchBar } from "@/components/search-bar";
import { StickyChrome } from "@/components/sticky-chrome";
import { SectionLabel } from "@/components/section-label";
import { ExplorePills } from "@/components/explore-pills";
import {
  ExploreHeroCarousel,
  type ExploreHeroItem,
} from "@/components/explore-hero";
import { ShowFollowButton } from "@/components/show-follow-button";
import { MovieWatchButton } from "@/components/movie-watch-button";
import { DiscoverRail } from "@/components/discover-rail";
import {
  DiscoverGenreBrowser,
  type GenreChip,
} from "@/components/discover-genre-browser";
import Link from "next/link";
import Image from "next/image";

/** Hourly slot — shifts which posters land in grids so re-visits feel different. */
const HOUR_MS = 60 * 60 * 1000;

function PosterTile({
  title,
  posterPath,
  href,
  action,
  owned,
}: {
  title: string;
  posterPath?: string | null;
  href: string;
  action: React.ReactNode;
  owned?: boolean;
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
          {owned && (
            <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary">
              In library
            </span>
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

export default async function ExplorePage() {
  const userId = await requireAuth();

  const [
    trendingDay,
    trendingWeek,
    trendingMoviesDay,
    popularMovies,
    airingToday,
    onTheAir,
    topTv,
    topMovies,
    nowPlaying,
    becauseRails,
    followedShows,
    followedMovies,
  ] = await Promise.all([
    getTrendingTv("day").catch(() => ({ results: [] as Array<{
      id: number;
      name: string;
      poster_path?: string;
      backdrop_path?: string;
      overview?: string;
      vote_average?: number;
    }> })),
    getTrendingTv("week").catch(() => ({ results: [] as Array<{
      id: number;
      name: string;
      poster_path?: string;
      backdrop_path?: string;
      overview?: string;
      vote_average?: number;
    }> })),
    getTrendingMovies("day").catch(() => ({ results: [] as Array<{
      id: number;
      title: string;
      poster_path?: string;
      backdrop_path?: string;
      overview?: string;
      vote_average?: number;
    }> })),
    getPopularMovies(),
    getAiringToday(),
    getOnTheAir(),
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
    followedMovies.map((m) => [m.tmdbId, m.status])
  );
  const ownedMovieIds = new Set(followedMovies.map((m) => m.tmdbId));

  // Prefetch genre chips for Discover
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

  // ── Trending today hero: several titles, rotated hourly ────────────────
  const heroPool: ExploreHeroItem[] = [];
  for (const s of trendingDay.results) {
    if (followedShowIds.has(s.id)) continue;
    heroPool.push({
      id: s.id,
      title: s.name,
      mediaType: "tv",
      posterPath: s.poster_path,
      backdropPath: s.backdrop_path,
      overview: s.overview,
      badge: "Trending today",
      following: false,
    });
  }
  // Fill with day-trending movies if TV pool is thin
  if (heroPool.length < 5) {
    for (const m of trendingMoviesDay.results) {
      if (ownedMovieIds.has(m.id)) continue;
      if (heroPool.some((h) => h.mediaType === "movie" && h.id === m.id))
        continue;
      heroPool.push({
        id: m.id,
        title: m.title,
        mediaType: "movie",
        posterPath: m.poster_path,
        backdropPath: m.backdrop_path,
        overview: m.overview,
        badge: "Trending today",
        movieStatus: movieStatusById.get(m.id) || null,
      });
      if (heroPool.length >= 8) break;
    }
  }
  // Last resort: week trending TV
  if (heroPool.length < 3) {
    for (const s of trendingWeek.results) {
      if (followedShowIds.has(s.id)) continue;
      if (heroPool.some((h) => h.mediaType === "tv" && h.id === s.id)) continue;
      heroPool.push({
        id: s.id,
        title: s.name,
        mediaType: "tv",
        posterPath: s.poster_path,
        backdropPath: s.backdrop_path,
        overview: s.overview,
        badge: "Trending this week",
        following: false,
      });
      if (heroPool.length >= 5) break;
    }
  }

  const heroItems = pickRotated(
    heroPool,
    Math.min(5, Math.max(3, heroPool.length)),
    rotationOffset(userId + ":hero", heroPool.length, HOUR_MS)
  ).map((h) =>
    h.mediaType === "movie"
      ? { ...h, movieStatus: movieStatusById.get(h.id) || null }
      : h
  );

  // ── Rest of feed: previous layout, with hourly window on grids ─────────
  const weekShows = trendingWeek.results;
  const trendingGrid = pickRotated(
    weekShows,
    9,
    rotationOffset(userId + ":trend-grid", weekShows.length, HOUR_MS)
  );

  const popularResults = popularMovies.results ?? [];
  const popularGrid = pickRotated(
    popularResults,
    9,
    rotationOffset(userId + ":pop-grid", popularResults.length, HOUR_MS)
  );

  const topTvPool = filterNewMedia(topTv, followedShowIds, 24);
  const topTvFresh = pickRotated(
    topTvPool,
    12,
    rotationOffset(userId + ":top-tv", topTvPool.length, HOUR_MS)
  );
  const nowPlayingPool = filterNewMedia(nowPlaying, ownedMovieIds, 24);
  const nowPlayingFresh = pickRotated(
    nowPlayingPool,
    12,
    rotationOffset(userId + ":now", nowPlayingPool.length, HOUR_MS)
  );
  const topMoviesPool = filterNewMedia(topMovies, ownedMovieIds, 24);
  const topMoviesFresh = pickRotated(
    topMoviesPool,
    12,
    rotationOffset(userId + ":top-m", topMoviesPool.length, HOUR_MS)
  );

  const feed = (
    <>
      <ExploreHeroCarousel items={heroItems} />

      {becauseRails.map((rail) => (
        <DiscoverRail
          key={rail.seedTitle}
          label={`Because you watched ${rail.seedTitle}`}
          items={rail.items}
          followedShowIds={followedShowIds}
          movieStatusById={movieStatusById}
        />
      ))}

      <GridSection label="Trending This Week">
        {trendingGrid.map((show) => (
          <PosterTile
            key={show.id}
            title={show.name}
            posterPath={show.poster_path}
            href={`/show/${show.id}`}
            owned={followedShowIds.has(show.id)}
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

      <DiscoverRail
        label="Top Rated TV"
        items={topTvFresh}
        followedShowIds={followedShowIds}
        movieStatusById={movieStatusById}
      />
      <DiscoverRail
        label="Now Playing"
        items={nowPlayingFresh}
        followedShowIds={followedShowIds}
        movieStatusById={movieStatusById}
      />

      <GridSection label="Popular Movies">
        {popularGrid.map((movie) => (
          <PosterTile
            key={movie.id}
            title={movie.title}
            posterPath={movie.poster_path}
            href={`/movie/${movie.id}`}
            owned={ownedMovieIds.has(movie.id)}
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

      <DiscoverRail
        label="Top Rated Movies"
        items={topMoviesFresh}
        followedShowIds={followedShowIds}
        movieStatusById={movieStatusById}
      />
    </>
  );

  const discover = (
    <>
      <DiscoverGenreBrowser genres={genreChips} />

      <GridSection label="Airing Today">
        {airingToday.results.slice(0, 9).map((show) => (
          <PosterTile
            key={show.id}
            title={show.name}
            posterPath={show.poster_path}
            href={`/show/${show.id}`}
            owned={followedShowIds.has(show.id)}
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

      <GridSection label="On The Air">
        {onTheAir.results.slice(0, 9).map((show) => (
          <PosterTile
            key={show.id}
            title={show.name}
            posterPath={show.poster_path}
            href={`/show/${show.id}`}
            owned={followedShowIds.has(show.id)}
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
