"use client";

import { useEffect, useMemo, useState } from "react";
import type { CommunityReview, ReviewSource } from "@/lib/reviews";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  ExternalLink,
  MessageSquare,
  X,
  Star,
} from "lucide-react";

type Filter = "all" | ReviewSource;

function monogram(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatWhen(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

function formatScore(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function starsFromTen(rating: number) {
  return (Math.round(rating) / 2).toFixed(1);
}

function ReviewRow({ review }: { review: CommunityReview }) {
  const [open, setOpen] = useState(false);
  const isReddit = review.source === "reddit";
  const long = review.content.length > 220;
  const when = formatWhen(review.createdAt);

  return (
    <article className="border-b border-white/[0.06] last:border-0">
      <div className="px-4 py-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
              isReddit
                ? "bg-[#ff4500]/12 text-[#ff6a33]"
                : "bg-primary/12 text-primary"
            )}
          >
            {review.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={review.avatarUrl}
                alt=""
                className="h-9 w-9 rounded-full object-cover"
              />
            ) : (
              monogram(review.author)
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-white">
                {review.author}
              </p>
              {review.rating != null && (
                <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-bold text-primary">
                  <Star className="h-3 w-3 fill-primary" />
                  {starsFromTen(review.rating)}
                </span>
              )}
            </div>
            <p className="truncate text-[11px] text-muted-foreground">
              {isReddit ? (
                <>
                  <span className="text-[#ff6a33]/90">
                    {review.subreddit ?? "Reddit"}
                  </span>
                  {review.score != null && (
                    <span className="text-white/30">
                      {" "}
                      · {formatScore(review.score)} up
                    </span>
                  )}
                  {review.commentCount != null && (
                    <span className="text-white/30">
                      {" "}
                      · {formatScore(review.commentCount)} comments
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="text-primary/80">TMDB</span>
                  {when && <span className="text-white/30"> · {when}</span>}
                </>
              )}
            </p>
          </div>

          {review.url && (
            <a
              href={review.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Open original"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>

        {review.title && (
          <h3 className="mt-3 text-[15px] font-semibold leading-snug text-white">
            {review.title}
          </h3>
        )}

        <p
          className={cn(
            "mt-2 text-[13px] leading-[1.55] text-white/65 whitespace-pre-wrap",
            !open && long && "line-clamp-3"
          )}
        >
          {review.content}
        </p>

        {long && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-2 text-xs font-semibold text-primary"
          >
            {open ? "Less" : "More"}
          </button>
        )}
      </div>
    </article>
  );
}

/**
 * Collapsed by default — one compact row on the detail page.
 * Tap opens a full-height sheet so "More like / Recommended" stay reachable.
 */
export function CommunityReviews({
  reviews,
  mediaTitle,
}: {
  reviews: CommunityReview[];
  mediaTitle?: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    let tmdb = 0;
    let reddit = 0;
    for (const r of reviews) {
      if (r.source === "tmdb") tmdb++;
      else if (r.id !== "reddit-browse") reddit++;
      else reddit++; // count browse card too for tab presence
    }
    // Don't inflate "all" with only a browse placeholder if no real reddit
    const realReddit = reviews.filter(
      (r) => r.source === "reddit" && r.id !== "reddit-browse"
    ).length;
    const browseOnly =
      realReddit === 0 && reviews.some((r) => r.id === "reddit-browse");
    return {
      tmdb,
      reddit: realReddit > 0 ? realReddit : browseOnly ? 1 : 0,
      all: reviews.length,
      realReddit,
    };
  }, [reviews]);

  const visible = useMemo(() => {
    if (filter === "all") return reviews;
    return reviews.filter((r) => r.source === filter);
  }, [reviews, filter]);

  // Lock body scroll while sheet open
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetOpen]);

  // Escape closes sheet
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  const summary =
    counts.tmdb > 0 && counts.realReddit > 0
      ? `${counts.tmdb} TMDB · ${counts.realReddit} Reddit`
      : counts.tmdb > 0
        ? `${counts.tmdb} review${counts.tmdb === 1 ? "" : "s"}`
        : counts.realReddit > 0
          ? `${counts.realReddit} thread${counts.realReddit === 1 ? "" : "s"}`
          : "TMDB & Reddit";

  const tabs = (
    [
      { id: "all" as const, label: "All", n: counts.all },
      { id: "tmdb" as const, label: "TMDB", n: counts.tmdb },
      { id: "reddit" as const, label: "Reddit", n: counts.reddit },
    ] satisfies { id: Filter; label: string; n: number }[]
  ).filter((t) => t.id === "all" || t.n > 0);

  return (
    <>
      {/* ── Compact trigger (always collapsed on page) ── */}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className={cn(
          "mt-4 flex w-full items-center gap-3 rounded-xl bg-card px-4 py-3.5 text-left",
          "ring-1 ring-white/[0.06] transition active:scale-[0.99]",
          "hover:ring-white/10"
        )}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12">
          <MessageSquare className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white">Reviews</p>
          <p className="truncate text-xs text-muted-foreground">{summary}</p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-white/30" />
      </button>

      {/* ── Full-screen sheet ── */}
      {sheetOpen && (
        <div className="fixed inset-0 z-[80] flex flex-col">
          {/* Scrim */}
          <button
            type="button"
            aria-label="Close reviews"
            className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
            onClick={() => setSheetOpen(false)}
          />

          {/* Panel */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Community reviews"
            className={cn(
              "relative mt-auto flex max-h-[92dvh] w-full flex-col",
              "rounded-t-[1.25rem] bg-[#0c0c0e] shadow-[0_-12px_40px_rgba(0,0,0,0.55)]",
              "ring-1 ring-white/[0.08]",
              "animate-in slide-in-from-bottom duration-300"
            )}
          >
            {/* Grab handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-white/15" />
            </div>

            {/* Sticky chrome */}
            <div className="shrink-0 border-b border-white/[0.06] px-4 pb-3 pt-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                    Community
                  </p>
                  <h2 className="truncate text-xl font-black tracking-tight text-white">
                    Reviews
                  </h2>
                  {mediaTitle && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
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

              {tabs.length > 1 && (
                <div className="mt-3 flex gap-1.5">
                  {tabs.map((tab) => {
                    const active = filter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setFilter(tab.id)}
                        className={cn(
                          "rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors",
                          active
                            ? tab.id === "reddit"
                              ? "bg-[#ff4500] text-white"
                              : "bg-primary text-black"
                            : "bg-white/[0.05] text-white/55 hover:text-white"
                        )}
                      >
                        {tab.label}
                        <span
                          className={cn(
                            "ml-1.5 tabular-nums",
                            active ? "opacity-80" : "opacity-50"
                          )}
                        >
                          {tab.n}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Scroll body */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-safe-page">
              {visible.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <p className="text-sm text-muted-foreground">
                    Nothing in this filter.
                  </p>
                </div>
              ) : (
                <div>
                  {visible.map((r) => (
                    <ReviewRow key={r.id} review={r} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
