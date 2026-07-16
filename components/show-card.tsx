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

export function ShowCard({ show }: { show: ShowCardData }) {
  const imgUrl = posterUrl(show.posterPath, "w342");
  const hasNext = show.nextEpisode != null;

  return (
    <Link href={`/show/${show.tmdbId}`} className="block overflow-hidden rounded-lg bg-card">
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
        {hasNext && show.remaining > 0 && (
          <div className="absolute right-1 top-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-black">
            +{show.remaining}
          </div>
        )}
      </div>
      <div className="p-2">
        <p className="truncate text-xs font-semibold text-white">{show.title}</p>
        {hasNext ? (
          <p className="text-[10px] text-muted-foreground">
            S{String(show.nextEpisode!.seasonNumber).padStart(2, "0")} | E
            {String(show.nextEpisode!.episodeNumber).padStart(2, "0")}
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground">Up to date</p>
        )}
      </div>
    </Link>
  );
}
