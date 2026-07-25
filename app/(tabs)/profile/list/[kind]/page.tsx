import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { shows, movies, userShows, userMovies } from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";
import { posterUrl } from "@/lib/tmdb";
import { RatingBadge } from "@/components/star-rating";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft } from "lucide-react";

const KINDS = {
  shows: { title: "Shows", favorite: false, movies: false },
  "favorite-shows": { title: "Favorite shows", favorite: true, movies: false },
  movies: { title: "Movies", favorite: false, movies: true },
  "favorite-movies": { title: "Favorite movies", favorite: true, movies: true },
} as const;

type Kind = keyof typeof KINDS;

export default async function ProfileListPage({
  params,
}: {
  params: Promise<{ kind: string }>;
}) {
  const { kind } = await params;
  if (!(kind in KINDS)) notFound();
  const config = KINDS[kind as Kind];

  const userId = await requireAuth();

  type GridItem = {
    tmdbId: number;
    title: string;
    posterPath: string | null;
    rating?: number | null;
  };

  const items: GridItem[] = config.movies
    ? await db
        .select({
          tmdbId: movies.tmdbId,
          title: movies.title,
          posterPath: movies.posterPath,
          rating: userMovies.rating,
        })
        .from(userMovies)
        .innerJoin(movies, eq(userMovies.tmdbId, movies.tmdbId))
        .where(
          config.favorite
            ? and(eq(userMovies.userId, userId), eq(userMovies.favorite, true))
            : eq(userMovies.userId, userId)
        )
        .orderBy(desc(userMovies.updatedAt))
    : await db
        .select({
          tmdbId: shows.tmdbId,
          title: shows.title,
          posterPath: shows.posterPath,
        })
        .from(userShows)
        .innerJoin(shows, eq(userShows.tmdbId, shows.tmdbId))
        .where(
          config.favorite
            ? and(eq(userShows.userId, userId), eq(userShows.favorite, true))
            : eq(userShows.userId, userId)
        )
        .orderBy(desc(userShows.updatedAt));

  const hrefPrefix = config.movies ? "/movie" : "/show";

  return (
    <div className="min-h-screen bg-black px-4 pb-24 pt-4">
      <div className="mb-5 flex items-center gap-3">
        <Link
          href="/profile"
          aria-label="Back to profile"
          className="flex h-9 w-9 items-center justify-center rounded-full text-white"
        >
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-xl font-bold text-white">{config.title}</h1>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center pt-24 text-center">
          <p className="mb-4 text-muted-foreground">
            {config.favorite
              ? `No favorite ${config.movies ? "movies" : "shows"} yet`
              : `No ${config.movies ? "movies" : "shows"} yet`}
          </p>
          <Link
            href="/explore"
            className="rounded-full bg-primary px-6 py-3 text-sm font-bold uppercase tracking-wide text-black"
          >
            Browse all
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {items.map((item) => (
            <Link
              key={item.tmdbId}
              href={`${hrefPrefix}/${item.tmdbId}`}
              className="overflow-hidden rounded-md bg-card"
            >
              <div
                style={{ aspectRatio: "2 / 3" }}
                className="relative bg-secondary"
              >
                {item.rating != null && <RatingBadge value={item.rating} />}
                {item.posterPath ? (
                  <Image
                    src={posterUrl(item.posterPath, "w342") ?? ""}
                    alt={item.title}
                    fill
                    sizes="(max-width: 768px) 33vw, 200px"
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[#3a7bd5] p-2 text-center">
                    <span className="text-xs font-medium text-white">
                      {item.title || "No title yet"}
                    </span>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
