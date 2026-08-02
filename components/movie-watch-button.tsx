"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Check, Plus } from "lucide-react";
import { useToast } from "@/components/toast";

export type MovieStatus = "want_to_watch" | "watched" | null;

/**
 * Movie library actions.
 *
 * Semantics (fixed): "Want to Watch" adds to the watchlist
 * (status = want_to_watch) — it never marks a movie watched.
 * Small surfaces (overlay/compact) are add-to-watchlist only and turn into a
 * static check once the movie is in the library; the full watch/unwatch and
 * remove controls live on the movie detail page (variant="full").
 */
export function MovieWatchButton({
  tmdbId,
  initialStatus,
  variant = "full",
}: {
  tmdbId: number;
  initialStatus: string | null;
  variant?: "overlay" | "compact" | "full";
}) {
  const router = useRouter();
  const { toast } = useToast();
  // Tolerate legacy statuses (e.g. for_later): any non-null value = in library
  const normalize = (s: string | null): MovieStatus =>
    s === "watched" ? "watched" : s ? "want_to_watch" : null;
  const [status, setStatus] = useState<MovieStatus>(() =>
    normalize(initialStatus)
  );
  const [pending, startTransition] = useTransition();

  const update = (next: MovieStatus) => {
    const prev = status;
    // Optimistic flip
    setStatus(next);
    try {
      navigator.vibrate?.(10);
    } catch {
      /* ignore */
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/movie-watch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tmdbId, status: next }),
        });
        if (!res.ok) throw new Error("save failed");
        if (next === "watched") toast("Marked watched");
        else if (next === "want_to_watch") toast("Added to watchlist");
        else toast("Removed from library", "info");
        router.refresh();
      } catch {
        setStatus(prev);
        toast("Couldn't save — try again", "error");
      }
    });
  };

  // ----- overlay: round + / ✓ on poster corners (explore grids) -----
  if (variant === "overlay") {
    if (status) {
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-black shadow">
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>
      );
    }
    return (
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          update("want_to_watch");
        }}
        disabled={pending}
        aria-label="Add to watchlist"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white shadow backdrop-blur-sm transition-colors hover:bg-black/80"
      >
        <Plus className="h-4 w-4" strokeWidth={3} />
      </button>
    );
  }

  // ----- compact: small round + / ✓ in search result rows -----
  if (variant === "compact") {
    if (status) {
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-black">
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      );
    }
    return (
      <button
        onClick={() => update("want_to_watch")}
        disabled={pending}
        aria-label="Add to watchlist"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-card text-white transition-colors hover:bg-secondary"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={3} />
      </button>
    );
  }

  // ----- full: movie detail page, explicit watchlist vs watched -----
  if (status === "watched") {
    return (
      <div className="flex gap-2">
        <button
          onClick={() => update("want_to_watch")}
          disabled={pending}
          className="flex-1 rounded-xl bg-primary py-3 text-sm font-bold text-black transition-colors"
        >
          ✓ Watched
        </button>
        <button
          onClick={() => update(null)}
          disabled={pending}
          className="rounded-xl border border-white/25 px-4 py-3 text-sm font-bold text-white/80 transition-colors hover:bg-card"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={() => update(status === "want_to_watch" ? null : "want_to_watch")}
        disabled={pending}
        className={cn(
          "flex-1 rounded-xl py-3 text-sm font-bold transition-colors",
          status === "want_to_watch"
            ? "bg-primary text-black"
            : "bg-card text-white hover:bg-secondary"
        )}
      >
        {status === "want_to_watch" ? "✓ On Watchlist" : "+ Want to Watch"}
      </button>
      <button
        onClick={() => update("watched")}
        disabled={pending}
        className="flex-1 rounded-xl bg-card py-3 text-sm font-bold text-white transition-colors hover:bg-secondary"
      >
        Mark Watched
      </button>
    </div>
  );
}
