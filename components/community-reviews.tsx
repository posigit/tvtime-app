"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  CommunityReview,
  ReviewSentiment,
  ReviewSource,
  ReviewsPayload,
} from "@/lib/reviews";
import { cn } from "@/lib/utils";
import {
  FreshIcon,
  RottenIcon,
  PopcornIcon,
} from "@/components/rt-icons";
import {
  ChevronRight,
  ExternalLink,
  MessageSquare,
  X,
  Star,
  ThumbsUp,
  MessagesSquare,
} from "lucide-react";

type Filter = "all" | "fresh" | "rotten" | ReviewSource;

function VerdictIcon({
  sentiment,
  size = "md",
}: {
  sentiment: ReviewSentiment;
  size?: "sm" | "md" | "lg";
}) {
  const cls =
    size === "lg" ? "h-8 w-8" : size === "sm" ? "h-5 w-5" : "h-6 w-6";
  if (sentiment === "fresh") return <FreshIcon className={cls} />;
  if (sentiment === "rotten") return <RottenIcon className={cls} />;
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full bg-[#ff4500]/15 text-[#ff6a33]",
        size === "lg" ? "h-8 w-8 text-sm" : "h-6 w-6 text-[10px]"
      )}
    >
      r/
    </div>
  );
}

function formatWhen(iso: string | null) {
  if (!iso) return null;
  // RT sometimes sends "03/20/2024" or "Jul 24"
  if (!iso.includes("T") && !/^\d{4}-/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatScore(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function starsFromTen(rating: number) {
  return (Math.round(rating) / 2).toFixed(1);
}

function sourceLabel(s: ReviewSource) {
  if (s === "rt") return "RT";
  if (s === "tmdb") return "TMDB";
  return "Reddit";
}

/** Pastel avatar disc with the author's initial, tinted per source. */
function AuthorAvatar({
  author,
  source,
}: {
  author: string;
  source: ReviewSource;
}) {
  const initial = (author.trim().charAt(0) || "?").toUpperCase();
  const tint =
    source === "rt"
      ? "bg-[#fa320a]/15 text-[#fa320a]"
      : source === "tmdb"
        ? "bg-primary/15 text-primary"
        : "bg-[#ff4500]/15 text-[#ff6a33]";
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black",
        tint
      )}
    >
      {initial}
    </div>
  );
}

/* ── Single review row ──────────────────────────────────────────── */

function ReviewRow({ review }: { review: CommunityReview }) {
  const [open, setOpen] = useState(false);
  const long = review.content.length > 200;
  const when = formatWhen(review.createdAt);

  if (review.featured) {
    return (
      <article className="mx-4 my-3 overflow-hidden rounded-2xl bg-gradient-to-br from-[#2a120c] to-[#1a1a1c] ring-1 ring-[#fa320a]/35">
        <div className="flex items-start gap-3 p-4">
          <VerdictIcon sentiment={review.sentiment} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#fa320a]">
              Critics Consensus
            </p>
            <p className="mt-1.5 text-[15px] font-medium leading-snug text-white/95">
              “{review.content}”
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/45">
              {review.score != null && (
                <span className="font-bold text-[#fa320a]">
                  {review.score}% Tomatometer
                </span>
              )}
              {review.url && (
                <a
                  href={review.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-white/60 hover:text-white"
                >
                  Rotten Tomatoes
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="border-b border-white/[0.05] last:border-0">
      <div className="flex gap-3 px-4 py-4">
        <AuthorAvatar author={review.author} source={review.source} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="truncate text-sm font-semibold text-white">
                  {review.author}
                </span>
                {review.rating != null && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                    <Star className="h-2.5 w-2.5 fill-primary" />
                    {starsFromTen(review.rating)}
                  </span>
                )}
                {review.sentiment && (
                  <VerdictIcon sentiment={review.sentiment} size="sm" />
                )}
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px]">
                <span
                  className={cn(
                    "font-semibold",
                    review.source === "rt" && "text-[#fa320a]/90",
                    review.source === "tmdb" && "text-primary/80",
                    review.source === "reddit" && "text-[#ff6a33]/90"
                  )}
                >
                  {sourceLabel(review.source)}
                </span>
                {review.meta && (
                  <span className="max-w-[12rem] truncate rounded-full bg-white/[0.05] px-1.5 py-px text-[10px] text-white/45">
                    {review.meta}
                  </span>
                )}
                {when && <span className="text-white/30">{when}</span>}
              </p>
            </div>

            {review.url && (
              <a
                href={review.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-white/40 transition hover:bg-white/10 hover:text-white"
                aria-label="Open original"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>

          {review.title && (
            <h3 className="mt-2 text-[14px] font-semibold leading-snug text-white/95">
              {review.title}
            </h3>
          )}

          <p
            className={cn(
              "mt-1.5 text-[13px] leading-[1.55] text-white/65 whitespace-pre-wrap",
              !open && long && "line-clamp-3"
            )}
          >
            {review.content}
          </p>

          <div className="mt-1.5 flex items-center gap-3">
            {long && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="text-xs font-bold text-primary"
              >
                {open ? "Show less" : "Read more"}
              </button>
            )}
            {review.source === "reddit" && review.score != null && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-white/35">
                <ThumbsUp className="h-3 w-3" />
                {formatScore(review.score)}
              </span>
            )}
            {review.source === "reddit" && review.commentCount != null && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-white/35">
                <MessagesSquare className="h-3 w-3" />
                {formatScore(review.commentCount)}
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/* ── Score chip (trigger + sheet header) ────────────────────────── */

function ScoreChip({
  icon,
  value,
  label,
  size = "md",
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <span
        className={cn(
          "font-black leading-none text-white",
          size === "sm" ? "text-sm" : "text-base"
        )}
      >
        {value}
      </span>
      <span className="text-[9px] font-bold uppercase tracking-wide text-white/35">
        {label}
      </span>
    </div>
  );
}

/* ── Main export ────────────────────────────────────────────────── */

export function CommunityReviews({
  payload,
  mediaTitle,
}: {
  payload: ReviewsPayload;
  mediaTitle?: string;
}) {
  const { reviews, rtScore, rtAudienceScore, rtState, counts } =
    payload;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const realReddit = useMemo(
    () => reviews.filter((r) => r.source === "reddit" && r.id !== "reddit-browse"),
    [reviews]
  );

  const visible = useMemo(() => {
    if (filter === "all") return reviews;
    if (filter === "fresh")
      return reviews.filter((r) => r.sentiment === "fresh");
    if (filter === "rotten")
      return reviews.filter((r) => r.sentiment === "rotten");
    return reviews.filter((r) => r.source === filter);
  }, [reviews, filter]);

  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetOpen]);

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  const rtFresh =
    rtScore != null ? rtScore >= 60 : rtState?.includes("fresh") ?? null;

  const tabs = (
    [
      { id: "all" as const, label: "All", n: counts.all },
      { id: "fresh" as const, label: "Fresh", n: counts.fresh },
      { id: "rotten" as const, label: "Rotten", n: counts.rotten },
      { id: "rt" as const, label: "RT", n: counts.rt },
      { id: "tmdb" as const, label: "Fans", n: counts.tmdb },
      {
        id: "reddit" as const,
        label: "Reddit",
        n: Math.max(counts.reddit, realReddit.length),
      },
    ] satisfies { id: Filter; label: string; n?: number }[]
  ).filter((t) => t.id === "all" || (t.n != null && t.n > 0));

  const subline = [
    counts.rt > 0 ? `${counts.rt} critic${counts.rt === 1 ? "" : "s"}` : null,
    counts.tmdb > 0 ? `${counts.tmdb} fan` : null,
    realReddit.length > 0 ? `${realReddit.length} Reddit` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const hasAnyScore = rtScore != null || rtAudienceScore != null;

  return (
    <>
      {/* ── Compact trigger ── */}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className={cn(
          "group mt-4 flex w-full items-center gap-3.5 rounded-2xl px-3.5 py-3 text-left",
          "bg-card ring-1 ring-white/[0.07]",
          "transition duration-200 hover:ring-white/15 active:scale-[0.99]"
        )}
      >
        {/* Lead score badge */}
        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
          {rtScore != null ? (
            <>
              {rtFresh ? (
                <FreshIcon className="h-11 w-11" />
              ) : (
                <RottenIcon className="h-11 w-11" />
              )}
              <span className="absolute inset-0 flex items-center justify-center pt-1 text-[11px] font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                {rtScore}
              </span>
            </>
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12">
              <MessageSquare className="h-5 w-5 text-primary" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold tracking-tight text-white">
            Reviews
          </p>
          {/* Score trio when available */}
          {hasAnyScore ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {rtAudienceScore != null && (
                <ScoreChip
                  size="sm"
                  icon={<PopcornIcon className="h-3.5 w-3.5" />}
                  value={`${rtAudienceScore}%`}
                  label="Audience"
                />
              )}
              {!rtAudienceScore && (
                <p className="truncate text-xs text-muted-foreground">
                  {subline || "Critics, fans & Reddit"}
                </p>
              )}
            </div>
          ) : (
            <p className="truncate text-xs text-muted-foreground">
              {subline || "Critics, fans & Reddit"}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {counts.fresh > 0 && (
            <span className="hidden items-center gap-0.5 rounded-full bg-[#fa320a]/12 px-2 py-0.5 text-[10px] font-bold text-[#fa320a] xs:inline-flex sm:inline-flex">
              <FreshIcon className="h-3.5 w-3.5" />
              {counts.fresh}
            </span>
          )}
          <ChevronRight className="h-5 w-5 text-white/25 transition group-hover:text-white/50" />
        </div>
      </button>

      {/* ── Sheet ── */}
      {sheetOpen && (
        <div className="fixed inset-0 z-[80] flex flex-col">
          <button
            type="button"
            aria-label="Close reviews"
            className="absolute inset-0 bg-black/75 backdrop-blur-[3px]"
            onClick={() => setSheetOpen(false)}
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Reviews"
            className={cn(
              "relative mt-auto flex max-h-[93dvh] w-full flex-col",
              "rounded-t-[1.35rem] bg-[#0a0a0c]",
              "shadow-[0_-20px_60px_rgba(0,0,0,0.65)]",
              "ring-1 ring-white/[0.08]",
              "animate-in slide-in-from-bottom duration-300"
            )}
          >
            <div className="flex justify-center pt-2.5 pb-1">
              <div className="h-1 w-10 rounded-full bg-white/15" />
            </div>

            <div className="shrink-0 border-b border-white/[0.06] px-4 pb-3 pt-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-xl font-black tracking-tight text-white">
                    Reviews
                  </h2>
                  {mediaTitle && (
                    <p className="truncate text-xs text-muted-foreground">
                      {mediaTitle}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/70 transition hover:bg-white/10 hover:text-white"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Score board */}
              {hasAnyScore && (
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-white/[0.03] px-3.5 py-2.5 ring-1 ring-white/[0.05]">
                  {rtScore != null && (
                    <ScoreChip
                      icon={
                        rtFresh ? (
                          <FreshIcon className="h-6 w-6" />
                        ) : (
                          <RottenIcon className="h-6 w-6" />
                        )
                      }
                      value={`${rtScore}%`}
                      label="Tomatometer"
                    />
                  )}
                  {rtAudienceScore != null && (
                    <ScoreChip
                      icon={<PopcornIcon className="h-6 w-6" />}
                      value={`${rtAudienceScore}%`}
                      label="Popcornmeter"
                    />
                  )}
                </div>
              )}

              <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
                {tabs.map((tab) => {
                  const active = filter === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setFilter(tab.id)}
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
                        active
                          ? tab.id === "rotten"
                            ? "bg-[#6ac04a] text-black"
                            : tab.id === "reddit"
                              ? "bg-[#ff4500] text-white"
                              : tab.id === "fresh" || tab.id === "rt"
                                ? "bg-[#fa320a] text-white"
                                : "bg-primary text-black"
                          : "bg-white/[0.05] text-white/55 hover:text-white"
                      )}
                    >
                      {tab.id === "fresh" && (
                        <FreshIcon className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
                      )}
                      {tab.id === "rotten" && (
                        <RottenIcon className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
                      )}
                      {tab.label}
                      {tab.n != null && (
                        <span className="ml-1 tabular-nums opacity-75">
                          {tab.n}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-safe-page">
              {visible.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <p className="text-sm text-muted-foreground">
                    Nothing in this filter yet.
                  </p>
                </div>
              ) : (
                visible.map((r) => <ReviewRow key={r.id} review={r} />)
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
