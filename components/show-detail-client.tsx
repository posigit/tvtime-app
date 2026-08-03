"use client";

import { useMemo, useState } from "react";
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
import { formatEpisodeLabel, useToast } from "@/components/toast";
import type { TmdbMediaCard, WatchProvidersResult } from "@/lib/tmdb";
import type { CommunityReview } from "@/lib/reviews";
import { Check, ChevronDown, MoreHorizontal } from "lucide-react";

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
  episodeRatings,
  derivedScore,
  moreLikeThis = [],
  recommended = [],
  providers = null,
  reviews = [],
}: {
  show: DetailShow;
  episodes: DetailEpisode[];
  rewatchCounts: Record<number, number>;
  initialFollowing: boolean;
  episodeRatings: Record<string, number>;
  derivedScore: { value: number; count: number } | null;
  moreLikeThis?: TmdbMediaCard[];
  recommended?: TmdbMediaCard[];
  providers?: WatchProvidersResult | null;
  reviews?: CommunityReview[];
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
  const [rewatchCounts, setRewatchCounts] = useState(initialRewatchCounts);
  const [activeTab, setActiveTab] = useState<"about" | "episodes">("episodes");
  const [confetti, setConfetti] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [following, setFollowing] = useState(initialFollowing);

  const [rewatchSeason, setRewatchSeason] = useState<number | null>(null);
  const [markPreviousTarget, setMarkPreviousTarget] =
    useState<DetailEpisode | null>(null);
  const [pending, setPending] = useState(false);

  const isWatched = (ep: DetailEpisode) =>
    watchedMap[watchKey(ep.seasonNumber, ep.episodeNumber)] ?? false;

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
  ) => {
    if (items.length === 0) return;

    const prev = watchedMap;
    const next = { ...watchedMap };
    for (const item of items) {
      next[watchKey(item.seasonNumber, item.episodeNumber)] = item.watched;
    }
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
      setWatchedMap(prev);
      toast("Couldn't save — try again", "error");
    }
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

  const confirmRewatch = async () => {
    if (rewatchSeason === null) return;
    const seasonNumber = rewatchSeason;
    setPending(true);
    try {
      const res = await fetch("/api/rewatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showTmdbId: show.tmdbId, seasonNumber }),
      });
      if (!res.ok) throw new Error("rewatch failed");
      const data = await res.json();

      // Reset local watched state for that season
      setWatchedMap((prev) => {
        const next = { ...prev };
        for (const ep of episodes) {
          if (ep.seasonNumber === seasonNumber) {
            next[watchKey(ep.seasonNumber, ep.episodeNumber)] = false;
          }
        }
        return next;
      });
      setRewatchCounts((prev) => ({
        ...prev,
        [seasonNumber]: data.count ?? (prev[seasonNumber] ?? 0) + 1,
      }));
      setExpandedSeasons((prev) => new Set(prev).add(seasonNumber));
      toast(`Season ${seasonNumber} rewatch started`);
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

        {/* Top controls — sit below notch / status bar */}
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="absolute left-4 top-safe-float flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white"
        >
          <ChevronDown className="h-5 w-5" />
        </button>
        <div className="absolute right-4 top-safe-float">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="More"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-11 z-30 w-44 overflow-hidden rounded-xl border border-white/10 bg-card shadow-xl">
              <button
                onClick={toggleFollow}
                className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-secondary"
              >
                {following ? "Remove from watch list" : "Add to watch list"}
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
                <span
                  className="flex h-6 w-6 items-center justify-center rounded bg-primary text-sm font-black text-black"
                  title="TMDB score"
                >
                  T
                </span>
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

          <CommunityReviews reviews={reviews} title="Community reviews" />

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
            <button
              onClick={() => handleEpisodeToggle(nextEpisode, true)}
              className="relative mb-6 flex h-28 w-full items-end overflow-hidden rounded-xl text-left"
            >
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
              <div className="relative flex w-full items-end justify-between p-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white">
                    S{String(nextEpisode.seasonNumber).padStart(2, "0")} | E
                    {String(nextEpisode.episodeNumber).padStart(2, "0")}
                  </p>
                  <p className="truncate text-xs text-white/80">
                    {nextEpisode.title}
                  </p>
                </div>
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white text-black">
                  <Check className="h-5 w-5" strokeWidth={3} />
                </span>
              </div>
            </button>
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
                              "flex items-center gap-3 rounded-lg bg-card p-2.5",
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
            <p className="mb-2 text-lg font-bold text-white">
              Rewatch {seasonLabel(rewatchSeason)}?
            </p>
            <p className="mb-6 text-sm text-muted-foreground">
              Your progress for {seasonLabel(rewatchSeason).toLowerCase()} will
              be reset so you can watch it again. Your rewatch badge becomes ×
              {(rewatchCounts[rewatchSeason] ?? 0) + 2}.
            </p>
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
    </div>
  );
}
