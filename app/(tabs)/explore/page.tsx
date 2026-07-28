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
    genreTv,
    genreMovies,
    becauseRails,
  ] = await Promise.all([
    getTrendingTv("week"),
    getPopularMovies(),
    getAiringToday(),
    getOnTheAir(),
    getTopRatedTv().catch(() => [] as TmdbMediaCard[]),
    getTopRatedMovies().catch(() => [] as TmdbMediaCard[]),
    getNowPlayingMovies().catch(() => [] as TmdbMediaCard[]),
    discoverTvByGenre(TV_GENRES[0].id).catch(() => [] as TmdbMediaCard[]),
    discoverMoviesByGenre(MOVIE_GENRES[0].id).catch(
      () => [] as TmdbMediaCard[]
    ),
    getBecauseYouWatched(userId, 14).catch(() => []),
  ]);

  const followedShows = await db
    .select({ tmdbId: userShows.tmdbId })
    .from(userShows)
    .where(eq(userShows.userId, userId));
  const followedShowIds = new Set(followedShows.map((s) => s.tmdbId));

  const followedMovies = await db
    .select({ tmdbId: userMovies.tmdbId, status: userMovies.status })
    .from(userMovies)
    .where(eq(userMovies.userId, userId));
  const movieStatusById = new Map(
    followedMovies.map((m) => [m.tmdbId, m.status])
  );
  const ownedMovieIds = new Set(followedMovies.map((m) => m.tmdbId));

  const topTvFresh = filterNewMedia(topTv, followedShowIds, 12);
  const topMoviesFresh = filterNewMedia(topMovies, ownedMovieIds, 12);
  const nowPlayingFresh = filterNewMedia(nowPlaying, ownedMovieIds, 12);
  const genreTvFresh = filterNewMedia(genreTv, followedShowIds, 12);
  const genreMoviesFresh = filterNewMedia(genreMovies, ownedMovieIds, 12);

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
      <section className="mb-4 mt-4">
        <div className="mb-3">
          <SectionLabel>Browse by mood</SectionLabel>
        </div>
        <div className="flex flex-wrap gap-2">
          {TV_GENRES.map((g) => (
            <span
              key={`tv-${g.id}`}
              className="rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-white/80"
            >
              TV · {g.name}
            </span>
          ))}
          {MOVIE_GENRES.map((g) => (
            <span
              key={`mv-${g.id}`}
              className="rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-white/70"
            >
              Film · {g.name}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-white/40">
          Showing {TV_GENRES[0].name} TV + {MOVIE_GENRES[0].name} films below.
          Open a title for more like it.
        </p>
      </section>

      <DiscoverRail
        label={`${TV_GENRES[0].name} shows`}
        items={genreTvFresh}
      />
      <DiscoverRail
        label={`${MOVIE_GENRES[0].name} movies`}
        items={genreMoviesFresh}
      />

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
    <div className="min-h-screen bg-black px-4 pb-24 pt-4">
      <SearchBar />
      <ExplorePills feed={feed} discover={discover} />
    </div>
  );
}
