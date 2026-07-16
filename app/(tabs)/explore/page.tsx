import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userShows, userMovies } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getTrendingTv, getPopularMovies, posterUrl } from "@/lib/tmdb";
import { SearchBar } from "@/components/search-bar";
import { SectionLabel } from "@/components/section-label";
import Link from "next/link";
import Image from "next/image";

export default async function ExplorePage() {
  const userId = await requireAuth();

  const trending = await getTrendingTv("week");
  const popularMovies = await getPopularMovies();

  const followedShows = await db
    .select({ tmdbId: userShows.tmdbId })
    .from(userShows)
    .where(eq(userShows.userId, userId));
  const followedShowIds = new Set(followedShows.map((s) => s.tmdbId));

  const followedMovies = await db
    .select({ tmdbId: userMovies.tmdbId })
    .from(userMovies)
    .where(eq(userMovies.userId, userId));
  const followedMovieIds = new Set(followedMovies.map((m) => m.tmdbId));

  return (
    <div className="min-h-screen bg-black px-4 py-4">
      <SearchBar />

      <section className="mt-6 mb-6">
        <div className="mb-3">
          <SectionLabel>Trending This Week</SectionLabel>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {trending.results.slice(0, 9).map((show) => (
            <Link
              key={show.id}
              href={`/show/${show.id}`}
              className="relative overflow-hidden rounded-lg bg-card"
            >
              <div style={{aspectRatio:"2 / 3"}} className="relative bg-secondary">
                {show.poster_path ? (
                  <Image
                    src={posterUrl(show.poster_path, "w342") ?? ""}
                    alt={show.name}
                    fill
                    sizes="(max-width: 768px) 33vw, 200px"
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
                    {show.name}
                  </div>
                )}
              </div>
              {followedShowIds.has(show.id) && (
                <div className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />
              )}
            </Link>
          ))}
        </div>
      </section>

      <section className="mb-6">
        <div className="mb-3">
          <SectionLabel>Popular Movies</SectionLabel>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {popularMovies.results.slice(0, 9).map((movie) => (
            <Link
              key={movie.id}
              href={`/movie/${movie.id}`}
              className="relative overflow-hidden rounded-lg bg-card"
            >
              <div style={{aspectRatio:"2 / 3"}} className="relative bg-secondary">
                {movie.poster_path ? (
                  <Image
                    src={posterUrl(movie.poster_path, "w342") ?? ""}
                    alt={movie.title}
                    fill
                    sizes="(max-width: 768px) 33vw, 200px"
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
                    {movie.title}
                  </div>
                )}
              </div>
              {followedMovieIds.has(movie.id) && (
                <div className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />
              )}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
