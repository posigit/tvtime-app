import Link from "next/link";
import Image from "next/image";
import { backdropUrl, posterUrl } from "@/lib/tmdb";
import { ShowFollowButton } from "@/components/show-follow-button";
import { MovieWatchButton } from "@/components/movie-watch-button";
import { TrailerButton } from "@/components/trailer-button";
import type { DailyPick } from "@/lib/explore-digest";

export function DailyPickCard({
  pick,
  following,
  movieStatus,
}: {
  pick: DailyPick;
  following?: boolean;
  movieStatus?: string | null;
}) {
  const { item, reason, trailerKey } = pick;
  const href =
    item.mediaType === "tv" ? `/show/${item.id}` : `/movie/${item.id}`;
  const bg =
    backdropUrl(item.backdrop_path, "w780") ||
    posterUrl(item.poster_path, "w500");

  return (
    <section className="mb-7">
      <p className="mb-2.5 text-[11px] font-black uppercase tracking-wider text-primary">
        Daily pick
      </p>
      <article className="relative overflow-hidden rounded-2xl bg-card ring-1 ring-white/10">
        <Link href={href} className="block">
          <div className="relative h-52 w-full">
            {bg ? (
              <Image
                src={bg}
                alt=""
                fill
                sizes="(max-width: 768px) 100vw, 420px"
                className="object-cover"
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
            className="relative h-[6.5rem] w-[4.4rem] flex-shrink-0 overflow-hidden rounded-md bg-secondary shadow-lg ring-1 ring-white/10"
          >
            {item.poster_path ? (
              <Image
                src={posterUrl(item.poster_path, "w185") ?? ""}
                alt={item.title}
                fill
                sizes="70px"
                className="object-cover"
                priority
              />
            ) : null}
          </Link>
          <div className="min-w-0 flex-1">
            <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-primary/90">
              {item.mediaType === "tv" ? "Series" : "Film"} · {reason}
            </p>
            <Link href={href}>
              <h2 className="line-clamp-2 text-[17px] font-black leading-tight text-white drop-shadow">
                {item.title}
              </h2>
            </Link>
            {item.overview && (
              <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-white/65">
                {item.overview}
              </p>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
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
                className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm"
              >
                Details
              </Link>
              <TrailerButton trailerKey={trailerKey} title={item.title} />
            </div>
          </div>
        </div>
      </article>
    </section>
  );
}
