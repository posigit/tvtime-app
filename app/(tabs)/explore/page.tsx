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
  discoverTvByGenre,
  discoverMoviesByGenre,
  posterUrl,
  TV_GENRES,
  MOVIE_GENRES,
  type TmdbMediaCard,
} from "@/lib/tmdb";
import { getBecauseYouWatched, filterNewMedia } from "@/lib/recommend";
import { SearchBar } from "@/components/search-bar";
import { SectionLabel } from "@/components/section-label";
import { ExplorePills } from "@/components/explore-pills";
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
    trending,
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
    getTrendingTv("week"),
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

  // Prefetch every genre chip (TMDB 1h cache) so taps switch instantly
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

  const topTvFresh = filterNewMedia(topTv, followedShowIds, 12);
  const topMoviesFresh = filterNewMedia(topMovies, ownedMovieIds, 12);
  const nowPlayingFresh = filterNewMedia(nowPlaying, ownedMovieIds, 12);

  const feed = (
    <>
      {becauseRails.map((rail) => (
        <DiscoverRail
          key={rail.seedTitle}
          label={`Because you watched ${rail.seedTitle}`}
          items={rail.items}
        />
      ))}

      <GridSection label="Trending This Week">
        {trending.results.slice(0, 9).map((show) => (
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

      <DiscoverRail label="Top Rated TV" items={topTvFresh} />
      <DiscoverRail label="Now Playing" items={nowPlayingFresh} />

      <GridSection label="Popular Movies">
        {popularMovies.results.slice(0, 9).map((movie) => (
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

      <DiscoverRail label="Top Rated Movies" items={topMoviesFresh} />
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
    <div className="min-h-dvh bg-black px-4 pb-nav-page pt-safe">
      <div className="pt-4">
        <SearchBar />
        <ExplorePills feed={feed} discover={discover} />
      </div>
    </div>
  );
}
