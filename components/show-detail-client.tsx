"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { backdropUrl, stillUrl } from "@/lib/tmdb";
import { cn } from "@/lib/utils";
import { isEpisodeAired } from "@/lib/show-progress";
import { daysUntilYmd, formatAppDateShort } from "@/lib/app-time";
import { Confetti } from "@/components/confetti";
import { EpisodeRating, StarRatingDisplay } from "@/components/star-rating";
import { DiscoverRail } from "@/components/discover-rail";
import { WatchProviders } from "@/components/watch-providers";
import { CommunityReviews } from "@/components/community-reviews";
import { TrailerButton } from "@/components/trailer-button";
import { VixPlayer } from "@/components/vix-player";
import { UpNextCard } from "@/components/up-next-card";
import { EndOfLineCard } from "@/components/end-of-line-card";
import { NextEpisodeFab } from "@/components/next-episode-fab";
import { FavoriteButton } from "@/components/favorite-button";
import { vixTvUrl } from "@/lib/vixsrc";
import { loadVixSettings } from "@/lib/vix-settings";
import { TmdbIcon } from "@/components/rt-icons";
import { formatEpisodeLabel, useToast } from "@/components/toast";
import type { TmdbMediaCard, WatchProvidersResult } from "@/lib/tmdb";
import type { ReviewsPayload } from "@/lib/reviews";
import type { PlaybackSummary } from "@/lib/playback";
import { formatPlaybackTime } from "@/lib/playback-format";
import { Check, ChevronDown, MoreHorizontal, Play } from "lucide-react";

export type DetailEpisode = {
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview?: string;
  airDate?: string;
  stillPath?: string | null;
  runtime?: number;
  watched: boolean;
};

export type DetailShow = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string | null;
  status: string | null;
  networks: string[] | null;
  numberOfSeasons: number | null;
  numberOfEpisodes: number | null;
  episodeRuntime: number | null;
  voteAverage: number | null;
  rtScore: number | null;
  firstAirDate: string | null;
};

function watchKey(seasonNumber: number, episodeNumber: number) {
  return `${seasonNumber}:${episodeNumber}`;
}

function compareEp(a: DetailEpisode, b: DetailEpisode) {
  return a.seasonNumber !== b.seasonNumber
    ? a.seasonNumber - b.seasonNumber
    : a.episodeNumber - b.episodeNumber;
}

function formatDate(airDate?: string) {
  return formatAppDateShort(airDate);
}

function seasonLabel(seasonNumber: number) {
  return seasonNumber === 0 ? "Specials" : `Season ${seasonNumber}`;
}

function daysUntil(airDate?: string): number | null {
  return daysUntilYmd(airDate);
}

export function ShowDetailClient({
  show,
  episodes,
  rewatchCounts: initialRewatchCounts,
  initialFollowing,
  initialFavorite = false,
  episodeRatings,
  derivedScore,
  moreLikeThis = [],
  recommended = [],
  providers = null,
  reviews,
  trailerKey = null,
  playbackPositions = {},
}: {
  show: DetailShow;
  episodes: DetailEpisode[];
  rewatchCounts: Record<number, number>;
  initialFollowing: boolean;
  initialFavorite?: boolean;
  episodeRatings: Record<string, number>;
  derivedScore: { value: number; count: number } | null;
  moreLikeThis?: TmdbMediaCard[];
  recommended?: TmdbMediaCard[];
  providers?: WatchProvidersResult | null;
  reviews?: ReviewsPayload;
  trailerKey?: string | null;
  playbackPositions?: Record<string, PlaybackSummary>;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [watchedMap, setWatchedMap] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const ep of episodes) {
      map[watchKey(ep.seasonNumber, ep.episodeNumber)] = ep.watched;
    }
    return map;
  });
  const watchedMapRef = useRef(watchedMap);
  const [rewatchCounts, setRewatchCounts] = useState(initialRewatchCounts);
  const [activeTab, setActiveTab] = useState<"about" | "episodes">("episodes");
  const [confetti, setConfetti] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [following, setFollowing] = useState(initialFollowing);

  const [rewatchSeason, setRewatchSeason] = useState<number | "all" | null>(
    null
  );
  const [markPreviousTarget, setMarkPreviousTarget] =
    useState<DetailEpisode | null>(null);
  const [pending, setPending] = useState(false);
  /** Episode currently open in the VixSrc player overlay. */
  const [playerEp, setPlayerEp] = useState<DetailEpisode | null>(null);
  const playerSessionRef = useRef(0);
  /** Next episode queued after the current one ends (autoplay countdown). */
  const [upNext, setUpNext] = useState<DetailEpisode | null>(null);
  const [upNextCount, setUpNextCount] = useState(0);
  /**
   * Stashed next ep after the user cancels Up Next. The glass Next FAB only
   * appears once playback hits ~96% (see nearEnd) — cancel alone does not
   * show it early.
   */
  const [manualNext, setManualNext] = useState<DetailEpisode | null>(null);
  /** True once VixPlayer reports progress ≥ NEXT_FAB_RATIO (0.96). */
  const [nearEnd, setNearEnd] = useState(false);
  /** True when the played episode ended and there's no next aired episode. */
  const [seriesEnded, setSeriesEnded] = useState(false);

  const isWatched = (ep: DetailEpisode) =>
    watchedMap[watchKey(ep.seasonNumber, ep.episodeNumber)] ?? false;

  const playbackFor = (ep: DetailEpisode) =>
    playbackPositions[watchKey(ep.seasonNumber, ep.episodeNumber)] ?? null;

  const resumeLabel = (ep: DetailEpisode) => {
    const playback = playbackFor(ep);
    if (!playback) return null;
    const timeLeft = formatPlaybackTime(playback.timeLeftSeconds);
    return timeLeft ? `Resume · ${timeLeft} left` : "Resume";
  };

  // ---------- derived data ----------

  const seasons = useMemo(() => {
    const bySeason = new Map<number, DetailEpisode[]>();
    for (const ep of episodes) {
      const arr = bySeason.get(ep.seasonNumber) ?? [];
      arr.push(ep);
      bySeason.set(ep.seasonNumber, arr);
    }
    return Array.from(bySeason.entries())
      .map(([seasonNumber, eps]) => {
        eps.sort(compareEp);
        const watchedCount = eps.filter((e) => isWatched(e)).length;
        return {
          seasonNumber,
          episodes: eps,
          total: eps.length,
          watchedCount,
          complete: eps.length > 0 && watchedCount === eps.length,
        };
      })
      .sort((a, b) => {
        if (a.seasonNumber === 0) return 1; // Specials last
        if (b.seasonNumber === 0) return -1;
        return a.seasonNumber - b.seasonNumber;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodes, watchedMap]);

  const allWatched =
    episodes.length > 0 && episodes.every((ep) => isWatched(ep));

  /** True when the show has no future episodes coming (ended, or catalog fully aired). */
  const fullyAired =
    show.status === "Ended" ||
    show.status === "Canceled" ||
    (episodes.length > 0 && episodes.every((ep) => isEpisodeAired(ep.airDate)));

  /** "Finished" only when everything is watched AND nothing more is coming. */
  const isFinished = allWatched && fullyAired;

  const nextEpisode = useMemo(() => {
    const sorted = [...episodes].sort(compareEp);
    return (
      sorted.find((ep) => !isWatched(ep) && isEpisodeAired(ep.airDate)) ?? null
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodes, watchedMap]);

  /** First unwatched UNAIRED episode — shown as countdown when caught up. */
  const nextUnaired = useMemo(() => {
    const sorted = [...episodes].sort(compareEp);
    return (
      sorted.find((ep) => !isWatched(ep) && !isEpisodeAired(ep.airDate)) ?? null
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodes, watchedMap]);

  const [expandedSeasons, setExpandedSeasons] = useState<Set<number>>(() => {
    const next = episodes.find(
      (ep) => !ep.watched && isEpisodeAired(ep.airDate)
    );
    return new Set(next ? [next.seasonNumber] : []);
  });

  // ---------- actions ----------

  const postWatch = async (
    items: {
      showTmdbId: number;
      seasonNumber: number;
      episodeNumber: number;
      watched: boolean;
    }[]
  ) => {
    const res = await fetch("/api/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        items.length === 1 ? items[0] : { episodes: items }
      ),
    });
    if (!res.ok) throw new Error("watch request failed");
  };

  /** Fire confetti only when this update truly finishes the series (fully aired + all watched). */
  const celebrateIfComplete = (map: Record<string, boolean>) => {
    if (!fullyAired) return;
    const done =
      episodes.length > 0 &&
      episodes.every(
        (ep) => map[watchKey(ep.seasonNumber, ep.episodeNumber)] ?? false
      );
    if (done) setConfetti(true);
  };

  const applyWatched = async (
    items: { seasonNumber: number; episodeNumber: number; watched: boolean }[]
  ): Promise<boolean> => {
    if (items.length === 0) return false;

    const prev = watchedMapRef.current;
    const next = { ...prev };
    for (const item of items) {
      next[watchKey(item.seasonNumber, item.episodeNumber)] = item.watched;
    }
    watchedMapRef.current = next;
    setWatchedMap(next);
    if (items.some((i) => i.watched)) {
      celebrateIfComplete(next);
      try {
        navigator.vibrate?.(10);
      } catch {
        /* ignore */
      }
    }

    try {
      await postWatch(
        items.map((i) => ({
          showTmdbId: show.tmdbId,
          seasonNumber: i.seasonNumber,
          episodeNumber: i.episodeNumber,
          watched: i.watched,
        }))
      );

      const marking = items.filter((i) => i.watched);
      const unmarking = items.filter((i) => !i.watched);
      if (marking.length === 1 && unmarking.length === 0) {
        toast(
          `Watched ${formatEpisodeLabel(marking[0].seasonNumber, marking[0].episodeNumber)}`
        );
      } else if (marking.length > 1 && unmarking.length === 0) {
        toast(`Marked ${marking.length} episodes watched`);
      } else if (unmarking.length > 0 && marking.length === 0) {
        toast(
          unmarking.length === 1
            ? "Unmarked episode"
            : `Unmarked ${unmarking.length} episodes`
        );
      }
    } catch {
      watchedMapRef.current = prev;
      setWatchedMap(prev);
      toast("Couldn't save — try again", "error");
      return false;
    }

    return true;
  };

  const previousUnwatchedAired = (episode: DetailEpisode) =>
    episodes.filter(
      (ep) =>
        compareEp(ep, episode) < 0 && !isWatched(ep) && isEpisodeAired(ep.airDate)
    );

  const handleEpisodeToggle = (episode: DetailEpisode, watched: boolean) => {
    if (watched && !isEpisodeAired(episode.airDate)) return;
    if (watched && previousUnwatchedAired(episode).length > 0) {
      setMarkPreviousTarget(episode);
      return;
    }
    void applyWatched([
      {
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        watched,
      },
    ]);
  };

  const handleMarkPrevious = async (includePrevious: boolean) => {
    const target = markPreviousTarget;
    setMarkPreviousTarget(null);
    if (!target) return;

    const items = includePrevious
      ? episodes
          .filter(
            (ep) =>
              compareEp(ep, target) <= 0 &&
              !isWatched(ep) &&
              isEpisodeAired(ep.airDate)
          )
          .map((ep) => ({
            seasonNumber: ep.seasonNumber,
            episodeNumber: ep.episodeNumber,
            watched: true,
          }))
      : [
          {
            seasonNumber: target.seasonNumber,
            episodeNumber: target.episodeNumber,
            watched: true,
          },
        ];
    await applyWatched(items);
  };

  const handleSeasonBadge = (season: {
    seasonNumber: number;
    episodes: DetailEpisode[];
    complete: boolean;
  }) => {
    if (season.complete) {
      setRewatchSeason(season.seasonNumber);
      return;
    }
    // Mark every aired episode of this season watched
    const items = season.episodes
      .filter((ep) => !isWatched(ep) && isEpisodeAired(ep.airDate))
      .map((ep) => ({
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
        watched: true,
      }));
    if (items.length > 0) void applyWatched(items);
  };

  const handleAllEpisodesToggle = () => {
    if (allWatched) {
      void applyWatched(
        episodes.map((ep) => ({
          seasonNumber: ep.seasonNumber,
          episodeNumber: ep.episodeNumber,
          watched: false,
        }))
      );
    } else {
      void applyWatched(
        episodes
          .filter((ep) => !isWatched(ep) && isEpisodeAired(ep.airDate))
          .map((ep) => ({
            seasonNumber: ep.seasonNumber,
            episodeNumber: ep.episodeNumber,
            watched: true,
          }))
      );
    }
  };

  const openPlayer = (ep: DetailEpisode) => {
    playerSessionRef.current += 1;
    setPlayerEp(ep);
    setSeriesEnded(false);
    setManualNext(null);
    setNearEnd(false);
    setUpNext(null);
    setUpNextCount(0);
  };

  /**
   * Streaming events from VixSrc. On "ended": mark the episode watched,
   * then auto-advance to the next unwatched aired episode (seamless binge).
   */
  const handlePlayerEvent = async (event: string) => {
    if (event !== "ended" || !playerEp) return;
    const session = playerSessionRef.current;
    const endedEpisode = playerEp;
    const alreadyWatched = isWatched(endedEpisode);

    if (!alreadyWatched) {
      const saved = await applyWatched([
        {
          seasonNumber: endedEpisode.seasonNumber,
          episodeNumber: endedEpisode.episodeNumber,
          watched: true,
        },
      ]);
      if (!saved) return;
      // Closing or replacing the player while the watch request was pending
      // cancels auto-advance instead of reopening the next episode.
      if (playerSessionRef.current !== session) return;
    }

    const next = [...episodes]
      .sort(compareEp)
      .find(
        (ep) =>
          compareEp(ep, endedEpisode) > 0 &&
          !watchedMapRef.current[watchKey(ep.seasonNumber, ep.episodeNumber)] &&
          isEpisodeAired(ep.airDate)
      );

    // Always surface Up Next when a later aired unwatched ep exists (season
    // finales → S+1E1 count). autoplayNext only controls the 10…0 auto-advance;
    // when off, the card still shows and the user taps to play (or X → FAB).
    if (next) {
      setManualNext(null);
      setUpNext(next);
      setUpNextCount(loadVixSettings().autoplayNext ? 10 : 0);
      return;
    }

    // No next aired episode (series finale, or waiting for next week): keep the
    // player OPEN so the final scene plays to the true end, and surface an
    // "end of the line" card instead of slamming the player shut at 92%.
    // Handles both first-run and rewatched episodes (an episode auto-completed
    // at 92% on a prior attempt is already watched — it must still show the
    // card instead of closing silently).
    setUpNext(null);
    setUpNextCount(0);
    setManualNext(null);
    setSeriesEnded(true);
  };

  /** Play the queued "up next" (or post-cancel manual) episode immediately. */
  const playUpNext = useCallback(() => {
    const next = upNext ?? manualNext;
    if (!next) return;
    playerSessionRef.current += 1;
    setPlayerEp(next);
    setUpNext(null);
    setUpNextCount(0);
    setManualNext(null);
    setNearEnd(false);
    setSeriesEnded(false);
  }, [upNext, manualNext]);

  /**
   * Cancel autoplay countdown only. Stash the next ep for the glass FAB;
   * do not show the FAB until nearEnd (≥96%) — unless already past that.
   */
  const cancelUpNext = useCallback(() => {
    if (upNext) setManualNext(upNext);
    setUpNext(null);
    setUpNextCount(0);
  }, [upNext]);

  // Count down the "up next" overlay; when it hits 0, auto-play the next ep.
  // upNextCount === 0 means autoplay is off — card stays, no timer.
  // Auto-fire happens in the timeout callback (event context), never in the
  // render phase. Bail if the player was closed mid-countdown (playerEp gone) —
  // never reopen an episode the user dismissed.
  useEffect(() => {
    if (!upNext || !playerEp || upNextCount <= 0) return;
    const t = window.setTimeout(() => {
      if (upNextCount <= 1) {
        playUpNext();
      } else {
        setUpNextCount(upNextCount - 1);
      }
    }, 1000);
    return () => window.clearTimeout(t);
  }, [upNext, upNextCount, playerEp, playUpNext]);

  const confirmRewatch = async () => {
    if (rewatchSeason === null) return;
    const target = rewatchSeason; // number (season) | "all" (whole series)
    setPending(true);
    try {
      const res = await fetch("/api/rewatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          showTmdbId: show.tmdbId,
          ...(target === "all"
            ? { season: "all" }
            : { seasonNumber: target }),
        }),
      });
      if (!res.ok) throw new Error("rewatch failed");
      const data = await res.json();

      // Non-destructive: server cleared resume bookmarks only. Local watched
      // state (and ratings/history) intentionally untouched — bump the badge
      // locally and let router.refresh() sync resume labels from the DB.
      if (target === "all") {
        setRewatchCounts((prev) => ({
          ...prev,
          [0]: data.count ?? (prev[0] ?? 0) + 1,
        }));
        setExpandedSeasons((prev) => {
          const first = seasons[0]?.seasonNumber;
          return first != null ? new Set(prev).add(first) : prev;
        });
        toast("Series rewatch started");
      } else {
        setRewatchCounts((prev) => ({
          ...prev,
          [target]: data.count ?? (prev[target] ?? 0) + 1,
        }));
        setExpandedSeasons((prev) => new Set(prev).add(target));
        toast(`Season ${target} rewatch started`);
      }
      router.refresh();
    } catch {
      toast("Couldn't start rewatch — try again", "error");
    } finally {
      setPending(false);
      setRewatchSeason(null);
    }
  };

  const toggleFollow = async () => {
    const next = !following;
    setFollowing(next);
    setMenuOpen(false);
    try {
      await fetch("/api/show-follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId: show.tmdbId, following: next }),
      });
    } catch {
      setFollowing(!next);
    }
  };

  /** Show the favorite affordance only once something's been watched. */
  const hasWatchedEpisodes = episodes.some((ep) => isWatched(ep));

  const toggleSeason = (seasonNumber: number) => {
    setExpandedSeasons((prev) => {
      const next = new Set(prev);
      if (next.has(seasonNumber)) next.delete(seasonNumber);
      else next.add(seasonNumber);
      return next;
    });
  };

  // ---------- header meta ----------

  const metaParts: string[] = [];
  if (show.numberOfSeasons) {
    metaParts.push(
      `${show.numberOfSeasons} season${show.numberOfSeasons === 1 ? "" : "s"}`
    );
  }
  if (show.status) metaParts.push(show.status);
  if (show.networks && show.networks.length > 0) metaParts.push(show.networks[0]);

  /** Rating badge: raw Tomatometer (96%) when RT exists, else TMDB X.X/10.
   *  `rt_score = -1` means "checked, no RT" — fall through to TMDB. */
  const rating =
    show.rtScore != null && show.rtScore >= 0
      ? { icon: "rt" as const, text: `${show.rtScore}%` }
      : show.voteAverage
        ? { icon: "tmdb" as const, text: `${show.voteAverage.toFixed(1)}/10` }
        : null;

  return (
    <div className="min-h-dvh bg-black pb-safe-page">
      <Confetti fire={confetti} />

      {/* ---------- Backdrop header (e4) ---------- */}
      <div className="relative h-detail-hero w-full overflow-hidden">
        {show.backdropPath ? (
          <Image
            src={backdropUrl(show.backdropPath, "w1280") ?? ""}
            alt={show.title}
            fill
            sizes="100vw"
            className="object-cover"
            unoptimized
            priority
          />
        ) : (
          <div className="h-full w-full bg-card" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/30" />

        {/* Centered play button opens the trailer */}
        {trailerKey && (
          <TrailerButton
            trailerKey={trailerKey}
            title={show.title}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/55 px-5 py-3 text-sm ring-1 ring-white/25"
          />
        )}

        {/* Top controls — sit below notch / status bar */}
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="absolute left-4 top-safe-float flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white"
        >
          <ChevronDown className="h-5 w-5" />
        </button>
        <div className="absolute right-4 top-safe-float">
          <div className="flex items-center gap-2">
            {hasWatchedEpisodes && (
              <FavoriteButton
                mediaType="tv"
                tmdbId={show.tmdbId}
                initialFavorite={initialFavorite}
              />
            )}
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="More"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
          </div>
          {menuOpen && (
            <div className="absolute right-0 top-11 z-30 w-44 overflow-hidden rounded-xl border border-white/10 bg-card shadow-xl">
              <button
                onClick={toggleFollow}
                className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-secondary"
              >
                {following ? "Remove from watch list" : "Add to watch list"}
              </button>
              <button
                onClick={() => {
                  setRewatchSeason("all");
                  setMenuOpen(false);
                }}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-white hover:bg-secondary"
              >
                <span>Rewatch series</span>
                {rewatchCounts[0] > 0 && (
                  <span className="text-xs font-bold text-success">
                    ×{rewatchCounts[0] + 1}
                  </span>
                )}
              </button>
              <button
                onClick={() => {
                  const complete = seasons.filter((s) => s.complete);
                  const target =
                    complete.at(-1)?.seasonNumber ?? seasons[0]?.seasonNumber;
                  if (target != null) {
                    setRewatchSeason(target);
                    setMenuOpen(false);
                  }
                }}
                className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-secondary"
              >
                Rewatch season
              </button>
            </div>
          )}
        </div>

        {/* Title block */}
        <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-black text-white drop-shadow">
              {show.title}
            </h1>
            {rewatchCounts[0] > 0 && (
              <span className="mt-1 inline-flex items-center rounded-full bg-success/20 px-2.5 py-0.5 text-[11px] font-bold text-success ring-1 ring-success/40">
                Rewatched ×{rewatchCounts[0] + 1}
              </span>
            )}
            <p className="mt-0.5 truncate text-sm text-white/80">
              {metaParts.join(" · ")}
            </p>
          </div>
          {rating && (
            <div className="flex flex-shrink-0 items-center gap-1.5">
              {rating.icon === "rt" ? (
                <span className="text-xl leading-none" title="Rotten Tomatoes">
                  🍅
                </span>
              ) : (
                <TmdbIcon className="h-6 w-6" />
              )}
              <span className="text-lg font-bold text-primary">
                {rating.text}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ---------- Your score (avg of your episode ratings) ---------- */}
      {derivedScore && (
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
          <StarRatingDisplay value={derivedScore.value} size={16} />
          <span className="text-sm font-bold text-primary">
            {(derivedScore.value / 2).toFixed(1)}
          </span>
          <span className="text-xs text-muted-foreground">
            your avg · {derivedScore.count} episode
            {derivedScore.count === 1 ? "" : "s"} rated
          </span>
        </div>
      )}

      {/* ---------- Tabs (ABOUT / EPISODES) ---------- */}
      <div className="sticky top-0 z-20 flex border-b border-white/10 bg-black pt-safe shadow-[0_1px_0_0_rgba(255,255,255,0.06)]">
        {(
          [
            { value: "about", label: "ABOUT" },
            { value: "episodes", label: "EPISODES" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={cn(
              "relative flex-1 pb-3 pt-3 text-center text-sm font-bold tracking-wide transition-colors",
              activeTab === tab.value
                ? "text-white"
                : "text-muted-foreground"
            )}
          >
            {tab.label}
            {activeTab === tab.value && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
            )}
          </button>
        ))}
      </div>

      {/* ---------- ABOUT ---------- */}
      {activeTab === "about" && (
        <div className="px-4 py-4">
          {show.overview ? (
            <p className="text-sm leading-relaxed text-white/90">
              {show.overview}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No overview yet.</p>
          )}

          <div className="mt-5 space-y-3 rounded-xl bg-card p-4">
            {show.firstAirDate && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">First aired</span>
                <span className="text-white">{formatDate(show.firstAirDate)}</span>
              </div>
            )}
            {show.status && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <span className="text-white">{show.status}</span>
              </div>
            )}
            {show.networks && show.networks.length > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Network</span>
                <span className="text-white">{show.networks.join(", ")}</span>
              </div>
            )}
            {show.numberOfSeasons && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Seasons</span>
                <span className="text-white">{show.numberOfSeasons}</span>
              </div>
            )}
            {show.numberOfEpisodes && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Episodes</span>
                <span className="text-white">{show.numberOfEpisodes}</span>
              </div>
            )}
            {show.episodeRuntime && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Runtime</span>
                <span className="text-white">{show.episodeRuntime} min</span>
              </div>
            )}
          </div>

          <button
            onClick={toggleFollow}
            className={cn(
              "mt-5 w-full rounded-full py-3 text-sm font-bold transition-colors",
              following
                ? "bg-card text-white"
                : "bg-primary text-black"
            )}
          >
            {following ? "✓ In your watch list" : "Add to watch list"}
          </button>

          {providers && <WatchProviders providers={providers} />}

          {reviews && (
            <CommunityReviews payload={reviews} mediaTitle={show.title} />
          )}

          <div className="mt-6">
            <DiscoverRail
              label={`More like ${show.title}`}
              items={moreLikeThis}
            />
            <DiscoverRail label="Recommended for you" items={recommended} />
          </div>
        </div>
      )}

      {/* ---------- EPISODES ---------- */}
      {activeTab === "episodes" && (
        <div className="px-4 py-4">
          {/* Continue tracking / Finished */}
          <h2 className="mb-3 text-lg font-bold text-white">
            Continue tracking
          </h2>
          {isFinished ? (
            <div className="relative mb-6 h-28 overflow-hidden rounded-xl">
              {show.backdropPath && (
                <Image
                  src={backdropUrl(show.backdropPath, "w780") ?? ""}
                  alt=""
                  fill
                  sizes="100vw"
                  className="object-cover opacity-40"
                  unoptimized
                />
              )}
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
                <p className="text-xl font-black text-primary">Finished</p>
                <p className="text-sm text-white/90">
                  That&apos;s all, folks!
                </p>
              </div>
            </div>
          ) : nextEpisode ? (
            <div className="relative mb-6 flex h-28 w-full items-end overflow-hidden rounded-xl">
              {nextEpisode.stillPath ? (
                <Image
                  src={stillUrl(nextEpisode.stillPath, "w300") ?? ""}
                  alt={nextEpisode.title}
                  fill
                  sizes="100vw"
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div className="absolute inset-0 bg-secondary" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
              <div className="relative flex w-full items-end justify-between gap-3 p-3">
                <button
                  type="button"
                  onClick={() => handleEpisodeToggle(nextEpisode, true)}
                  className="min-w-0 flex-1 text-left"
                  aria-label={`Mark ${nextEpisode.title} watched`}
                >
                  <p className="text-sm font-bold text-white">
                    S{String(nextEpisode.seasonNumber).padStart(2, "0")} | E
                    {String(nextEpisode.episodeNumber).padStart(2, "0")}
                  </p>
                  <p className="truncate text-xs text-white/80">
                    {nextEpisode.title}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openPlayer(nextEpisode)}
                    aria-label={`Play ${nextEpisode.title}`}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-black transition active:scale-95"
                  >
                    <Play className="h-4 w-4 fill-current" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEpisodeToggle(nextEpisode, true)}
                    aria-label={`Mark ${nextEpisode.title} watched`}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black transition active:scale-95"
                  >
                    <Check className="h-5 w-5" strokeWidth={3} />
                  </button>
                </div>
              </div>
            </div>
          ) : nextUnaired ? (
            <div className="relative mb-6 flex h-28 w-full items-end overflow-hidden rounded-xl">
              {nextUnaired.stillPath ? (
                <Image
                  src={stillUrl(nextUnaired.stillPath, "w300") ?? ""}
                  alt={nextUnaired.title}
                  fill
                  sizes="100vw"
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div className="absolute inset-0 bg-secondary" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
              <div className="relative flex w-full items-end justify-between p-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white">
                    S{String(nextUnaired.seasonNumber).padStart(2, "0")} | E
                    {String(nextUnaired.episodeNumber).padStart(2, "0")}
                  </p>
                  <p className="truncate text-xs text-white/80">
                    {nextUnaired.title}
                  </p>
                  {nextUnaired.airDate && (
                    <p className="text-[11px] text-primary">
                      {formatDate(nextUnaired.airDate)}
                    </p>
                  )}
                </div>
                {daysUntil(nextUnaired.airDate) !== null && (
                  <div className="flex w-14 flex-shrink-0 flex-col items-center justify-center">
                    <span className="text-2xl font-black leading-none text-white">
                      {daysUntil(nextUnaired.airDate)}
                    </span>
                    <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-white/70">
                      {daysUntil(nextUnaired.airDate) === 1 ? "day" : "days"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* All episodes row */}
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">All episodes</h2>
            <button
              onClick={handleAllEpisodesToggle}
              aria-label="Toggle all episodes"
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full border-2 transition-colors",
                allWatched
                  ? "border-success bg-success text-white"
                  : "border-white/40 text-white/60"
              )}
            >
              <Check className="h-5 w-5" strokeWidth={3} />
            </button>
          </div>

          {/* Season accordions */}
          <div className="space-y-2.5">
            {seasons.map((season) => {
              const rewatchCount = rewatchCounts[season.seasonNumber] ?? 0;
              const expanded = expandedSeasons.has(season.seasonNumber);
              return (
                <div key={season.seasonNumber}>
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-lg bg-card px-4 py-3.5",
                      season.complete && "border-b-4 border-success"
                    )}
                  >
                    <button
                      onClick={() => toggleSeason(season.seasonNumber)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      <span className="truncate text-base font-bold text-white">
                        {seasonLabel(season.seasonNumber)}
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 flex-shrink-0 text-white transition-transform",
                          expanded && "rotate-180"
                        )}
                      />
                    </button>
                    <span className="flex-shrink-0 text-sm text-muted-foreground">
                      {season.watchedCount}/{season.total}
                    </span>
                    {rewatchCount > 0 && (
                      <span className="flex-shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-bold text-success ring-1 ring-success/30">
                        Rewatch ×{rewatchCount + 1}
                      </span>
                    )}
                    <button
                      onClick={() => handleSeasonBadge(season)}
                      aria-label={
                        season.complete
                          ? `Rewatch ${seasonLabel(season.seasonNumber)}`
                          : `Mark ${seasonLabel(season.seasonNumber)} watched`
                      }
                      className={cn(
                        "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors",
                        rewatchCount > 0
                          ? "bg-success text-sm font-black text-white"
                          : season.complete
                            ? "bg-success text-white"
                            : "border-2 border-white/25 text-white/40"
                      )}
                    >
                      {rewatchCount > 0 ? (
                        <span>×{rewatchCount + 1}</span>
                      ) : (
                        <Check className="h-5 w-5" strokeWidth={3} />
                      )}
                    </button>
                  </div>

                  {/* Episode list */}
                  {expanded && (
                    <div className="mt-2 space-y-2">
                      {season.episodes.map((ep) => {
                        const watched = isWatched(ep);
                        const aired = isEpisodeAired(ep.airDate);
                        return (
                          <div
                            key={`${ep.seasonNumber}-${ep.episodeNumber}`}
                            className={cn(
                              "flex flex-wrap items-center gap-3 rounded-lg bg-card p-2.5",
                              !aired && !watched && "opacity-60"
                            )}
                          >
                            <div className="relative h-14 w-24 flex-shrink-0 overflow-hidden rounded-md bg-secondary">
                              {ep.stillPath ? (
                                <Image
                                  src={stillUrl(ep.stillPath, "w300") ?? ""}
                                  alt={ep.title}
                                  fill
                                  sizes="96px"
                                  className="object-cover"
                                  unoptimized
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                                  No img
                                </div>
                              )}
                              {watched && (
                                <div className="absolute inset-0 bg-black/50" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-white">
                                E{ep.episodeNumber}. {ep.title}
                              </p>
                              {ep.airDate && (
                                <p className="text-xs text-muted-foreground">
                                  {formatDate(ep.airDate)}
                                  {!aired && (
                                    <span className="text-primary">
                                      {" "}
                                      · Not aired yet
                                    </span>
                                  )}
                                </p>
                              )}
                              {resumeLabel(ep) && !watched && (
                                <button
                                  type="button"
                                  onClick={() => openPlayer(ep)}
                                  className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-bold text-primary ring-1 ring-primary/30 transition hover:bg-primary/25 active:scale-95"
                                >
                                  <Play className="h-3 w-3 flex-shrink-0 fill-current" />
                                  <span className="truncate">
                                    {resumeLabel(ep)}
                                  </span>
                                </button>
                              )}
                              {watched && (
                                <EpisodeRating
                                  showTmdbId={show.tmdbId}
                                  seasonNumber={ep.seasonNumber}
                                  episodeNumber={ep.episodeNumber}
                                  initialRating={
                                    episodeRatings[
                                      watchKey(ep.seasonNumber, ep.episodeNumber)
                                    ] ?? null
                                  }
                                />
                              )}
                            </div>
                            {/* Resume pill is already the play CTA — hide the
                                circular Play so they don't overlap on mobile. */}
                            {!(resumeLabel(ep) && !watched) && (
                              <button
                                onClick={() => openPlayer(ep)}
                                disabled={!aired}
                                aria-label={
                                  aired
                                    ? `Play ${ep.title}`
                                    : "Not aired yet"
                                }
                                className={cn(
                                  "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors",
                                  aired
                                    ? "bg-primary text-black active:scale-95"
                                    : "cursor-not-allowed bg-white/[0.04] text-white/20"
                                )}
                              >
                                <Play className="h-3.5 w-3.5 fill-current" />
                              </button>
                            )}
                            <button
                              onClick={() => handleEpisodeToggle(ep, !watched)}
                              disabled={!aired && !watched}
                              aria-label={
                                watched ? "Mark unwatched" : "Mark watched"
                              }
                              className={cn(
                                "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                                watched
                                  ? "border-success bg-success text-white"
                                  : !aired
                                    ? "cursor-not-allowed border-white/10 text-white/20"
                                    : "border-white/25 text-white/40"
                              )}
                            >
                              <Check className="h-4 w-4" strokeWidth={3} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---------- Rewatch dialog ---------- */}
      {rewatchSeason !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6">
            {rewatchSeason === "all" ? (
              <>
                <p className="mb-2 text-lg font-bold text-white">
                  Rewatch {show.title}?
                </p>
                <p className="mb-6 text-sm text-muted-foreground">
                  Every season&apos;s resume points clear so you can binge it again.
                  Your progress, ratings and watch history stay. Your series
                  rewatch badge becomes ×{(rewatchCounts[0] ?? 0) + 2}.
                </p>
              </>
            ) : (
              <>
                <p className="mb-2 text-lg font-bold text-white">
                  Rewatch {seasonLabel(rewatchSeason)}?
                </p>
                <p className="mb-6 text-sm text-muted-foreground">
                  {seasonLabel(rewatchSeason)}&apos;s resume points clear so you can
                  watch it again. Your progress, ratings and watch history stay.
                  Your rewatch badge becomes ×
                  {(rewatchCounts[rewatchSeason] ?? 0) + 2}.
                </p>
              </>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setRewatchSeason(null)}
                disabled={pending}
                className="flex-1 rounded-full border border-white/20 py-3 text-sm font-medium text-white"
              >
                Cancel
              </button>
              <button
                onClick={confirmRewatch}
                disabled={pending}
                className="flex-1 rounded-full bg-success py-3 text-sm font-bold text-white"
              >
                Rewatch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Mark previous dialog ---------- */}
      {markPreviousTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6">
            <p className="mb-2 text-lg font-bold text-white">
              Mark previous episodes?
            </p>
            <p className="mb-6 text-sm text-muted-foreground">
              There are {previousUnwatchedAired(markPreviousTarget).length}{" "}
              earlier unwatched episode
              {previousUnwatchedAired(markPreviousTarget).length === 1
                ? ""
                : "s"}
              . Mark everything up to S{markPreviousTarget.seasonNumber}E
              {markPreviousTarget.episodeNumber} as watched?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => void handleMarkPrevious(false)}
                className="flex-1 rounded-full border border-white/20 py-3 text-sm font-medium text-white"
              >
                Just this one
              </button>
              <button
                onClick={() => void handleMarkPrevious(true)}
                className="flex-1 rounded-full bg-primary py-3 text-sm font-bold text-black"
              >
                Yes, mark all
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Up-next autoplay overlay (over the player) ---------- */}
      {upNext && playerEp && (
        <UpNextCard
          episode={upNext}
          currentSeason={playerEp.seasonNumber}
          countdown={upNextCount}
          onPlay={playUpNext}
          onCancel={cancelUpNext}
        />
      )}

      {/* Glass Next: only after ≥96% AND countdown is gone (post-cancel). */}
      {nearEnd && manualNext && playerEp && !upNext && (
        <NextEpisodeFab onNext={playUpNext} />
      )}

      {/* End of the line: the played episode ended and there's no next aired
          episode — keep the player open so the finale plays to the true end.
          Small bottom-right card, auto-dismisses; X dismisses only the card. */}
      {seriesEnded && playerEp && (
        <EndOfLineCard
          episodeLabel={`${show.title} — S${playerEp.seasonNumber}E${playerEp.episodeNumber}`}
          onDismiss={() => setSeriesEnded(false)}
        />
      )}

      {/* ---------- VixSrc streaming player ---------- */}
      {playerEp && (
        <VixPlayer
          key={`${show.tmdbId}-${playerEp.seasonNumber}-${playerEp.episodeNumber}`}
          src={vixTvUrl(
            show.tmdbId,
            playerEp.seasonNumber,
            playerEp.episodeNumber
          )}
          type="tv"
          tmdbId={show.tmdbId}
          season={playerEp.seasonNumber}
          episode={playerEp.episodeNumber}
          title={`${show.title} — S${playerEp.seasonNumber}E${playerEp.episodeNumber} ${playerEp.title}`}
          initialPosition={playbackFor(playerEp)?.positionSeconds}
          autoResume={Boolean(playbackFor(playerEp))}
          runtimeSeconds={(show.episodeRuntime ?? 0) * 60}
          onEvent={handlePlayerEvent}
          onNearEnd={() => setNearEnd(true)}
          onClose={() => {
            playerSessionRef.current += 1;
            setPlayerEp(null);
            setSeriesEnded(false);
            setManualNext(null);
            setNearEnd(false);
            setUpNext(null);
            setUpNextCount(0);
            // Re-fetch playback server state so resume labels reflect saves.
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
