import Link from "next/link";
import Image from "next/image";
import { posterUrl } from "@/lib/tmdb";

export type ShowCardData = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  nextEpisode?: {
    seasonNumber: number;
    episodeNumber: number;
    title: string;
  } | null;
  remaining: number;
  seasonProgress?: {
    seasonNumber: number;
    percent: number;
  } | null;
};

/** Poster-only grid tile (snapshot 3 style) */
export function ShowCard({ show }: { show: ShowCardData }) {
  const imgUrl = posterUrl(show.posterPath, "w342");

  return (
    <Link
      href={`/show/${show.tmdbId}`}
      className="block overflow-hidden rounded-md bg-card"
    >
      <div style={{ aspectRatio: "2 / 3" }} className="relative bg-secondary">
        {imgUrl ? (
          <Image
            src={imgUrl}
            alt={show.title}
            fill
            sizes="(max-width: 768px) 33vw, 200px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
            {show.title}
          </div>
        )}
        {show.nextEpisode && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1.5 pt-7">
            <p className="truncate text-[10px] font-bold leading-tight text-white">
              S{show.nextEpisode.seasonNumber} E{show.nextEpisode.episodeNumber}
              {show.seasonProgress != null && (
                <span className="text-white/70">
                  {" "}
                  · {show.seasonProgress.percent}%
                </span>
              )}
            </p>
            {show.seasonProgress != null && (
              <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${show.seasonProgress.percent}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
