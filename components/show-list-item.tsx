import Link from "next/link";
import Image from "next/image";
import { posterUrl } from "@/lib/tmdb";
import { MarkWatchedButton } from "./mark-watched-button";

export type ShowListItemData = {
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

export function ShowListItem({ show }: { show: ShowListItemData }) {
  const imgUrl = posterUrl(show.posterPath, "w154");
  const hasNext = show.nextEpisode != null;

  return (
    <div className="flex items-center gap-3 rounded-xl bg-[#111112] p-3">
      <Link href={`/show/${show.tmdbId}`} className="flex-shrink-0">
        <div
          className="flex-shrink-0 overflow-hidden rounded-lg bg-[#2c2c2e]"
          style={{ width: 56, height: 84 }}
        >
          {imgUrl ? (
            <Image
              src={imgUrl}
              alt={show.title}
              width={56}
              height={84}
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
              No img
            </div>
          )}
        </div>
      </Link>

      <Link href={`/show/${show.tmdbId}`} className="min-w-0 flex-1">
        <div className="mb-1.5 inline-flex items-center gap-1 rounded-full border border-white/80 px-2.5 py-0.5 text-xs font-bold text-white">
          {show.title}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>

        <p className="text-sm font-bold text-white">
          {hasNext ? (
            <>
              S{String(show.nextEpisode!.seasonNumber).padStart(2, "0")} | E
              {String(show.nextEpisode!.episodeNumber).padStart(2, "0")}
              {show.remaining > 0 && (
                <span className="text-muted-foreground"> +{show.remaining}</span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">Up to date</span>
          )}
        </p>

        {hasNext && show.nextEpisode!.title && (
          <p className="truncate text-xs text-muted-foreground">{show.nextEpisode!.title}</p>
        )}
      </Link>

      {hasNext && (
        <MarkWatchedButton
          showTmdbId={show.tmdbId}
          seasonNumber={show.nextEpisode!.seasonNumber}
          episodeNumber={show.nextEpisode!.episodeNumber}
        />
      )}
    </div>
  );
}
