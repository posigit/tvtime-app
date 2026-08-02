import Link from "next/link";
import Image from "next/image";
import { backdropUrl, posterUrl } from "@/lib/tmdb";
import { ShowFollowButton } from "@/components/show-follow-button";
import { MovieWatchButton } from "@/components/movie-watch-button";

export type ExploreHeroItem = {
  id: number;
  title: string;
  mediaType: "tv" | "movie";
  posterPath?: string | null;
  backdropPath?: string | null;
  overview?: string | null;
  badge?: string;
};

/**
 * Large featured card at the top of Explore Feed — backdrop, title, one-tap add.
 */
export function ExploreHero({
  item,
  following,
  movieStatus,
}: {
  item: ExploreHeroItem;
  following?: boolean;
  movieStatus?: string | null;
}) {
  const href = item.mediaType === "tv" ? `/show/${item.id}` : `/movie/${item.id}`;
  const bg =
    backdropUrl(item.backdropPath, "w780") ||
    posterUrl(item.posterPath, "w500");

  return (
    <section className="mb-6">
      <div className="relative overflow-hidden rounded-2xl bg-card">
        <Link href={href} className="block">
          <div className="relative h-48 w-full sm:h-56">
            {bg ? (
              <Image
                src={bg}
                alt=""
                fill
                sizes="100vw"
                className="object-cover"
                unoptimized
                priority
              />
            ) : (
              <div className="h-full w-full bg-secondary" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/20" />
          </div>
        </Link>

        <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-3.5">
          <Link
            href={href}
            className="relative h-24 w-16 flex-shrink-0 overflow-hidden rounded-md bg-secondary shadow-lg ring-1 ring-white/10"
          >
            {item.posterPath ? (
              <Image
                src={posterUrl(item.posterPath, "w185") ?? ""}
                alt={item.title}
                fill
                sizes="64px"
                className="object-cover"
                unoptimized
                priority
              />
            ) : null}
          </Link>

          <div className="min-w-0 flex-1 pb-0.5">
            {item.badge && (
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                {item.badge}
              </p>
            )}
            <Link href={href}>
              <h2 className="truncate text-lg font-black leading-tight text-white drop-shadow">
                {item.title}
              </h2>
            </Link>
            {item.overview && (
              <p className="mt-1 line-clamp-2 text-xs leading-snug text-white/70">
                {item.overview}
              </p>
            )}
            <div className="mt-2.5 flex items-center gap-2">
              {item.mediaType === "tv" ? (
                <ShowFollowButton
                  tmdbId={item.id}
                  initialFollowing={!!following}
                  variant="compact"
                />
              ) : (
                <MovieWatchButton
                  tmdbId={item.id}
                  initialStatus={movieStatus ?? null}
                  variant="compact"
                />
              )}
              <Link
                href={href}
                className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-sm"
              >
                Details
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
