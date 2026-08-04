"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Play } from "lucide-react";
import { posterUrl } from "@/lib/tmdb";
import { formatAppDateShort } from "@/lib/app-time";
import { vixMovieUrl, vixTvUrl } from "@/lib/vixsrc";
import { VixPlayer } from "@/components/vix-player";
import type { ContinueWatchingItem, WatchHistoryItem } from "@/lib/playback";
import { formatEpisodeCode, formatPlaybackTime } from "@/lib/playback-format";
import { useToast } from "@/components/toast";

function itemLabel(item: WatchHistoryItem) {
  if (item.mediaType !== "tv") return "Movie";
  const code = formatEpisodeCode(item.seasonNumber, item.episodeNumber);
  return `${code}${item.episodeTitle ? ` · ${item.episodeTitle}` : ""}`;
}

function playerTitle(item: WatchHistoryItem) {
  return item.mediaType === "tv" && item.episodeTitle
    ? `${item.title} — ${itemLabel(item)}`
    : item.title;
}

async function markComplete(item: WatchHistoryItem) {
  if (item.mediaType === "movie") {
    return fetch("/api/movie-watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tmdbId: item.tmdbId, status: "watched" }),
    });
  }
  return fetch("/api/watch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      showTmdbId: item.tmdbId,
      seasonNumber: item.seasonNumber,
      episodeNumber: item.episodeNumber,
      watched: true,
    }),
  });
}

function StreamPlayer({
  item,
  onClose,
}: {
  item: WatchHistoryItem;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [completed, setCompleted] = useState(false);
  const src =
    item.mediaType === "tv"
      ? vixTvUrl(item.tmdbId, item.seasonNumber, item.episodeNumber)
      : vixMovieUrl(item.tmdbId);

  const handleEvent = async (event: string) => {
    if (event !== "ended" || completed) return;
    setCompleted(true);
    try {
      const response = await markComplete(item);
      if (!response.ok) throw new Error("completion failed");
      toast("Saved as watched");
    } catch {
      setCompleted(false);
      toast("Couldn’t save watched status", "error");
    }
  };

  return (
    <VixPlayer
      src={src}
      type={item.mediaType}
      tmdbId={item.tmdbId}
      season={item.mediaType === "tv" ? item.seasonNumber : undefined}
      episode={item.mediaType === "tv" ? item.episodeNumber : undefined}
      title={playerTitle(item)}
      initialPosition={item.positionSeconds ?? undefined}
      autoResume={item.positionSeconds != null}
      onEvent={handleEvent}
      onClose={() => {
        onClose();
        router.refresh();
      }}
    />
  );
}

function ProfileStreamTile({ item }: { item: WatchHistoryItem }) {
  const [open, setOpen] = useState(false);
  const poster = posterUrl(item.posterPath, "w342");
  const timeLeft = formatPlaybackTime(item.timeLeftSeconds);
  const isInProgress = item.positionSeconds != null && item.positionSeconds > 0;

  if (open) {
    return <StreamPlayer item={item} onClose={() => setOpen(false)} />;
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="group w-[13rem] shrink-0 text-left active:scale-[0.98]"
    >
      <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-secondary ring-1 ring-white/[0.08] transition group-hover:ring-primary/60">
        {poster ? (
          <Image
            src={poster}
            alt={item.title}
            fill
            sizes="184px"
            className="object-cover transition duration-300 group-hover:scale-105"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center p-3 text-center text-xs text-muted-foreground">
            {item.title}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
        <span className="absolute bottom-2 left-2 flex h-8 w-8 items-center justify-center rounded-full bg-white text-black shadow-lg">
          <Play className="h-4 w-4 fill-current" />
        </span>
        {item.progressPercent != null && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
            <span
              className="block h-full bg-primary"
              style={{ width: `${item.progressPercent}%` }}
            />
          </span>
        )}
      </div>
      <div className="pt-2">
        <p className="truncate text-sm font-bold tracking-[-0.01em] text-white">
          {item.title}
        </p>
        <p className="mt-0.5 truncate text-[11px] font-medium text-white/45">
          {itemLabel(item)}
        </p>
        <p className="mt-1.5 text-xs font-semibold text-primary">
          {isInProgress
            ? timeLeft
              ? `${timeLeft} remaining`
              : "Resume"
            : `Played ${formatAppDateShort(item.watchedAt.slice(0, 10))}`}
        </p>
      </div>
    </button>
  );
}

function StreamRow({ item }: { item: WatchHistoryItem }) {
  const [open, setOpen] = useState(false);
  const poster = posterUrl(item.posterPath, "w185");
  const timeLeft = formatPlaybackTime(item.timeLeftSeconds);

  if (open) {
    return <StreamPlayer item={item} onClose={() => setOpen(false)} />;
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex w-full items-center gap-3 rounded-xl bg-card p-2.5 text-left transition hover:bg-secondary active:scale-[0.99]"
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
        <p className="truncate text-sm font-bold text-white">{item.title}</p>
        <p className="mt-0.5 truncate text-xs font-semibold text-muted-foreground">
          {itemLabel(item)}
        </p>
        <p className="mt-1 text-[11px] font-black text-primary">
          {timeLeft ? `Resume · ${timeLeft} left` : "Play again"}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <span className="text-[10px] font-bold text-muted-foreground">
          {formatAppDateShort(item.watchedAt.slice(0, 10))}
        </span>
        <Play className="h-4 w-4 fill-current text-primary" />
      </div>
    </button>
  );
}

function toHistoryItem(item: ContinueWatchingItem): WatchHistoryItem {
  return {
    id: `playback-${item.key}`,
    mediaType: item.mediaType,
    tmdbId: item.tmdbId,
    title: item.title,
    posterPath: item.posterPath,
    seasonNumber: item.seasonNumber,
    episodeNumber: item.episodeNumber,
    episodeTitle: item.episodeTitle,
    watchedAt: item.updatedAt,
    source: "resume",
    positionSeconds: item.positionSeconds,
    durationSeconds: item.durationSeconds,
    timeLeftSeconds: item.timeLeftSeconds,
    progressPercent: item.progressPercent,
  };
}

export function ProfilePlaybackShelf({
  continueItems,
  recentItems,
}: {
  continueItems: ContinueWatchingItem[];
  recentItems: WatchHistoryItem[];
}) {
  const seen = new Set<string>();
  const items = [...continueItems.map(toHistoryItem), ...recentItems].filter(
    (item) => {
      const key = `${item.mediaType}:${item.tmdbId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }
  ).slice(0, 10);
  if (items.length === 0) return null;

  const hasProgress = continueItems.length > 0;

  return (
    <section className="mb-10 pt-1">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-[-0.02em] text-white">
            {hasProgress ? "Keep watching" : "Recently played"}
          </h2>
          <p className="mt-0.5 text-xs text-white/45">
            {hasProgress ? "Pick up exactly where you left off." : "Your latest viewing activity."}
          </p>
        </div>
        <Link
          href="/profile/history"
          className="text-xs font-bold text-white/55 transition hover:text-white"
        >
          History
        </Link>
      </div>
      <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => (
          <ProfileStreamTile key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

export function RecentStreamsList({ items }: { items: WatchHistoryItem[] }) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <StreamRow key={item.id} item={item} />
      ))}
    </div>
  );
}
