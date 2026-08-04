import { requireAuth } from "@/lib/auth";
import { getWatchHistory } from "@/lib/playback";
import { formatEpisodeCode } from "@/lib/playback-format";
import { posterUrl } from "@/lib/tmdb";
import { formatAppDateShort } from "@/lib/app-time";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, History } from "lucide-react";
import { StickyChrome } from "@/components/sticky-chrome";

function relativeLabel(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThat = new Date(
    then.getFullYear(),
    then.getMonth(),
    then.getDate()
  );
  const days = Math.round(
    (startToday.getTime() - startThat.getTime()) / (24 * 60 * 60 * 1000)
  );
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return formatAppDateShort(iso.slice(0, 10));
}

export default async function WatchHistoryPage() {
  const userId = await requireAuth();
  const items = await getWatchHistory(userId, 100).catch(() => []);

  return (
    <div className="min-h-dvh bg-black pb-nav-page">
      <StickyChrome contentClassName="px-4 pt-3 pb-2">
        <div className="flex items-center gap-3">
          <Link
            href="/profile"
            aria-label="Back to profile"
            className="flex h-9 w-9 items-center justify-center rounded-full text-white active:scale-95"
          >
            <ChevronLeft className="h-6 w-6" />
          </Link>
          <h1 className="text-xl font-bold text-white">Watch history</h1>
        </div>
      </StickyChrome>

      <div className="px-4 pt-4">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-24 text-center">
            <History className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="mb-1 font-bold text-white">No watch history yet</p>
            <p className="mb-6 max-w-[240px] text-sm text-muted-foreground">
              What you stream finishes will show up here so you can pick up
              right where you left off.
            </p>
            <Link
              href="/profile"
              className="rounded-full bg-primary px-6 py-3 text-sm font-bold text-black"
            >
              Back to profile
            </Link>
          </div>
        ) : (
          <>
            <p className="mb-4 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <History className="h-3.5 w-3.5" />
              {items.length} item{items.length === 1 ? "" : "s"} · last 100
            </p>

            <div className="space-y-2">
              {items.map((item) => {
                const poster = posterUrl(item.posterPath, "w185");
                const episodeCode =
                  item.mediaType === "tv"
                    ? formatEpisodeCode(item.seasonNumber, item.episodeNumber)
                    : null;
                return (
                  <Link
                    key={item.id}
                    href={
                      item.mediaType === "tv"
                        ? `/show/${item.tmdbId}`
                        : `/movie/${item.tmdbId}`
                    }
                    className="flex items-center gap-3 rounded-xl bg-card p-2.5 active:scale-[0.99]"
                  >
                    <div className="relative h-[66px] w-[44px] flex-shrink-0 overflow-hidden rounded-md bg-secondary">
                      {poster ? (
                        <Image
                          src={poster}
                          alt={item.title}
                          fill
                          sizes="44px"
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center p-1 text-center text-[8px] text-muted-foreground">
                          {item.title}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-white">
                        {item.title}
                      </p>
                      <p className="mt-0.5 truncate text-xs font-semibold text-muted-foreground">
                        {episodeCode
                          ? `${episodeCode}${item.episodeTitle ? ` · ${item.episodeTitle}` : ""}`
                          : "Movie"}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] font-bold text-muted-foreground">
                      {relativeLabel(item.watchedAt)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
