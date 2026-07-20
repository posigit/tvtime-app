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
      </div>
    </Link>
  );
}
