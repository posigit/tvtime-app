import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userShows, userMovies } from "@/lib/schema";
import { eq } from "drizzle-orm";
import {
  getTrendingTv,
  getPopularMovies,
  getAiringToday,
  getOnTheAir,
  posterUrl,
} from "@/lib/tmdb";
import { SearchBar } from "@/components/search-bar";
import { SectionLabel } from "@/components/section-label";
import { ExplorePills } from "@/components/explore-pills";
import { ShowFollowButton } from "@/components/show-follow-button";
import { MovieWatchButton } from "@/components/movie-watch-button";
import Link from "next/link";
import Image from "next/image";

function PosterTile({
  title,
  posterPath,
  href,
  followed,
  action,
}: {
  title: string;
  posterPath?: string;
  href: string;
  followed: boolean;
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
      {followed ? (
        <div className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />
      ) : (
        <div className="absolute bottom-0 left-0 right-0 p-2">{action}</div>
      )}
    </div>
  );
}

export default async function ExplorePage() {
  const userId = await requireAuth();

  const [trending, popularMovies, airingToday, onTheAir] = await Promise.all([
    getTrendingTv("week"),
    getPopularMovies(),
    getAiringToday(),
    getOnTheAir(),
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
  const followedMovieIds = new Set(followedMovies.map((m) => m.tmdbId));
  const movieStatusById = new Map(followedMovies.map((m) => [m.tmdbId, m.status]));

  const feed = (
    <>
      <section className="mb-6 mt-4">
        <div className="mb-3">
          <SectionLabel>Trending This Week</SectionLabel>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {trending.results.slice(0, 9).map((show) => (
            <PosterTile
              key={show.id}
              title={show.name}
              posterPath={show.poster_path}
              href={`/show/${show.id}`}
              followed={followedShowIds.has(show.id)}
              action={
                <ShowFollowButton tmdbId={show.id} initialFollowing={false} />
              }
            />
          ))}
        </div>
      </section>

      <section className="mb-6">
        <div className="mb-3">
          <SectionLabel>Popular Movies</SectionLabel>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {popularMovies.results.slice(0, 9).map((movie) => (
            <PosterTile
              key={movie.id}
              title={movie.title}
              posterPath={movie.poster_path}
              href={`/movie/${movie.id}`}
              followed={followedMovieIds.has(movie.id)}
              action={
                <MovieWatchButton
                  tmdbId={movie.id}
                  initialStatus={movieStatusById.get(movie.id) || null}
                />
              }
            />
          ))}
        </div>
      </section>
    </>
  );

  const discover = (
    <>
      <section className="mb-6 mt-4">
        <div className="mb-3">
          <SectionLabel>Airing Today</SectionLabel>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {airingToday.results.slice(0, 9).map((show) => (
            <PosterTile
              key={show.id}
              title={show.name}
              posterPath={show.poster_path}
              href={`/show/${show.id}`}
              followed={followedShowIds.has(show.id)}
              action={
                <ShowFollowButton tmdbId={show.id} initialFollowing={false} />
              }
            />
          ))}
        </div>
      </section>

      <section className="mb-6">
        <div className="mb-3">
          <SectionLabel>On The Air</SectionLabel>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {onTheAir.results.slice(0, 9).map((show) => (
            <PosterTile
              key={show.id}
              title={show.name}
              posterPath={show.poster_path}
              href={`/show/${show.id}`}
              followed={followedShowIds.has(show.id)}
              action={
                <ShowFollowButton tmdbId={show.id} initialFollowing={false} />
              }
            />
          ))}
        </div>
      </section>
    </>
  );

  return (
    <div className="min-h-screen bg-black px-4 pb-24 pt-4">
      <SearchBar />
      <ExplorePills feed={feed} discover={discover} />
    </div>
  );
}
