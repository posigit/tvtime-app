import Link from "next/link";
import Image from "next/image";
import { posterUrl, type TmdbMediaCard } from "@/lib/tmdb";
import { SectionLabel } from "@/components/section-label";
import { ShowFollowButton } from "@/components/show-follow-button";
import { MovieWatchButton } from "@/components/movie-watch-button";

export function DiscoverRail({
  label,
  items,
  followedShowIds,
  movieStatusById,
  showAdd = true,
}: {
  label: string;
  items: TmdbMediaCard[];
  /** When set with showAdd, TV cards get a follow + */
  followedShowIds?: Set<number>;
  /** When set with showAdd, movie cards get watchlist + */
  movieStatusById?: Map<number, string | null | undefined>;
  showAdd?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <section className="mb-6">
      <div className="mb-3">
        <SectionLabel>{label}</SectionLabel>
      </div>
      <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const href =
            item.mediaType === "tv"
              ? `/show/${item.id}`
              : `/movie/${item.id}`;
          const canAdd = showAdd && (followedShowIds || movieStatusById);

          return (
            <div
              key={`${item.mediaType}-${item.id}`}
              className="relative w-[7.25rem] flex-shrink-0"
            >
              <Link
                href={href}
                className="block overflow-hidden rounded-lg bg-card"
              >
                <div
                  style={{ aspectRatio: "2 / 3" }}
                  className="relative bg-secondary"
                >
                  {item.poster_path ? (
                    <Image
                      src={posterUrl(item.poster_path, "w342") ?? ""}
                      alt={item.title}
                      fill
                      sizes="116px"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center p-2 text-center text-[10px] text-muted-foreground">
                      {item.title}
                    </div>
                  )}
                  {item.badge && (
                    <span className="absolute bottom-1 left-1 max-w-[90%] truncate rounded bg-black/75 px-1.5 py-0.5 text-[8px] font-bold uppercase text-primary">
                      {item.badge}
                    </span>
                  )}
                </div>
                <p className="truncate px-1.5 py-1.5 text-[11px] font-medium text-white/90">
                  {item.title}
                </p>
              </Link>

              {canAdd && item.mediaType === "tv" && followedShowIds && (
                <div className="absolute right-1.5 top-1.5">
                  <ShowFollowButton
                    tmdbId={item.id}
                    initialFollowing={followedShowIds.has(item.id)}
                    variant="overlay"
                  />
                </div>
              )}
              {canAdd && item.mediaType === "movie" && movieStatusById && (
                <div className="absolute right-1.5 top-1.5">
                  <MovieWatchButton
                    tmdbId={item.id}
                    initialStatus={movieStatusById.get(item.id) || null}
                    variant="overlay"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
