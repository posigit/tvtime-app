"use client";

import { useMemo, useState } from "react";
import type { CommunityReview, ReviewSource } from "@/lib/reviews";
import { cn } from "@/lib/utils";
import { ExternalLink, MessageCircle, ChevronDown } from "lucide-react";

type Filter = "all" | ReviewSource;

function monogram(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatWhen(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatScore(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function starsFromTen(rating: number) {
  // TMDB author ratings are out of 10
  const half = Math.round(rating) / 2;
  return half.toFixed(1);
}

function ReviewCard({
  review,
  index,
}: {
  review: CommunityReview;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = review.content.length > 280;
  const when = formatWhen(review.createdAt);
  const isReddit = review.source === "reddit";

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-white/[0.06]",
        "bg-gradient-to-br from-white/[0.04] to-transparent",
        "transition-colors duration-300 hover:border-white/[0.12]"
      )}
      style={{ animationDelay: `${index * 45}ms` }}
    >
      {/* Source accent rail */}
      <div
        className={cn(
          "absolute inset-y-0 left-0 w-[3px]",
          isReddit
            ? "bg-gradient-to-b from-[#ff4500] via-[#ff8717] to-[#ff4500]/60"
            : "bg-gradient-to-b from-primary via-primary/70 to-primary/30"
        )}
      />

      <div className="pl-4 pr-4 pt-4 pb-3.5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold tracking-wide",
              isReddit
                ? "bg-[#ff4500]/15 text-[#ff8717] ring-1 ring-[#ff4500]/30"
                : "bg-primary/15 text-primary ring-1 ring-primary/30"
            )}
            aria-hidden
          >
            {review.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={review.avatarUrl}
                alt=""
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : isReddit ? (
              <span className="text-base leading-none">◆</span>
            ) : (
              monogram(review.author)
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-semibold text-white">
                {review.author}
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  isReddit
                    ? "bg-[#ff4500]/15 text-[#ff8717]"
                    : "bg-primary/15 text-primary"
                )}
              >
                {isReddit ? "Reddit" : "TMDB"}
              </span>
              {review.rating != null && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                  <span aria-hidden>★</span>
                  {starsFromTen(review.rating)}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
              {review.subreddit && (
                <span className="font-medium text-white/50">{review.subreddit}</span>
              )}
              {when && <span>{when}</span>}
              {isReddit && review.score != null && (
                <span className="tabular-nums">{formatScore(review.score)} pts</span>
              )}
              {isReddit && review.commentCount != null && (
                <span className="inline-flex items-center gap-0.5 tabular-nums">
                  <MessageCircle className="h-3 w-3 opacity-70" />
                  {formatScore(review.commentCount)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Reddit thread title */}
        {review.title && (
          <h4 className="mt-3 text-[15px] font-semibold leading-snug tracking-tight text-white/95">
            {review.title}
          </h4>
        )}

        {/* Body */}
        <p
          className={cn(
            "mt-2 text-[13px] leading-relaxed text-white/70 whitespace-pre-wrap",
            !expanded && long && "line-clamp-4"
          )}
        >
          {review.content}
        </p>

        {/* Actions */}
        <div className="mt-3 flex items-center justify-between gap-2">
          {long ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary transition-opacity hover:opacity-80"
            >
              {expanded ? "Show less" : "Read more"}
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  expanded && "rotate-180"
                )}
              />
            </button>
          ) : (
            <span />
          )}

          {review.url && (
            <a
              href={review.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide",
                "bg-white/[0.06] text-white/80 ring-1 ring-white/[0.08]",
                "transition-all hover:bg-white/[0.1] hover:text-white"
              )}
            >
              {isReddit ? "Thread" : "Full review"}
              <ExternalLink className="h-3 w-3 opacity-70" />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export function CommunityReviews({
  reviews,
  title = "Community",
}: {
  reviews: CommunityReview[];
  title?: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    let tmdb = 0;
    let reddit = 0;
    for (const r of reviews) {
      if (r.source === "tmdb") tmdb++;
      else reddit++;
    }
    return { tmdb, reddit, all: reviews.length };
  }, [reviews]);

  const visible = useMemo(() => {
    if (filter === "all") return reviews;
    return reviews.filter((r) => r.source === filter);
  }, [reviews, filter]);

  if (reviews.length === 0) {
    return (
      <section className="mt-8">
        <header className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary/80">
              Voices
            </p>
            <h2 className="text-lg font-black tracking-tight text-white">
              {title}
            </h2>
          </div>
        </header>
        <div className="relative overflow-hidden rounded-2xl border border-dashed border-white/10 bg-gradient-to-b from-white/[0.03] to-transparent px-5 py-10 text-center">
          <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-primary/10 blur-2xl" />
          <p className="relative text-sm text-muted-foreground">
            No community reviews yet for this title.
          </p>
          <p className="relative mt-1 text-xs text-white/30">
            TMDB write-ups and Reddit threads show up when people talk about it.
          </p>
        </div>
      </section>
    );
  }

  const tabs: { id: Filter; label: string; count: number }[] = (
    [
      { id: "all" as const, label: "All", count: counts.all },
      { id: "tmdb" as const, label: "TMDB", count: counts.tmdb },
      { id: "reddit" as const, label: "Reddit", count: counts.reddit },
    ] satisfies { id: Filter; label: string; count: number }[]
  ).filter((t) => t.id === "all" || t.count > 0);

  return (
    <section className="mt-8">
      <header className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary/80">
            Voices
          </p>
          <h2 className="text-lg font-black tracking-tight text-white">
            {title}
            <span className="ml-2 text-sm font-semibold text-muted-foreground">
              {counts.all}
            </span>
          </h2>
        </div>

        <div
          className="flex rounded-full bg-secondary/80 p-0.5 ring-1 ring-white/[0.06]"
          role="tablist"
          aria-label="Filter reviews by source"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              onClick={() => setFilter(tab.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-all",
                filter === tab.id
                  ? tab.id === "reddit"
                    ? "bg-[#ff4500] text-white shadow-sm"
                    : "bg-primary text-black shadow-sm"
                  : "text-muted-foreground hover:text-white"
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "ml-1 tabular-nums opacity-70",
                  filter === tab.id && "opacity-90"
                )}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </header>

      <div className="space-y-3">
        {visible.map((review, i) => (
          <ReviewCard key={review.id} review={review} index={i} />
        ))}
      </div>

      {visible.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nothing in this filter.
        </p>
      )}
    </section>
  );
}
