"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { Check, Plus } from "lucide-react";

/**
 * Show follow button. Small surfaces (overlay/compact) follow-only and turn
 * into a static check once followed — unfollowing deletes watched history,
 * so that stays on the show detail page menu.
 */
export function ShowFollowButton({
  tmdbId,
  initialFollowing,
  variant = "full",
}: {
  tmdbId: number;
  initialFollowing: boolean;
  variant?: "overlay" | "compact" | "full";
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next = !following;
    setFollowing(next);
    startTransition(async () => {
      try {
        await fetch("/api/show-follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tmdbId, following: next }),
        });
      } catch {
        setFollowing(following);
      }
    });
  };

  // ----- overlay: round + / ✓ on poster corners (explore grids) -----
  if (variant === "overlay") {
    if (following) {
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
          toggle();
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
    if (following) {
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-black">
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      );
    }
    return (
      <button
        onClick={toggle}
        disabled={pending}
        aria-label="Add to watchlist"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-card text-white transition-colors hover:bg-secondary"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={3} />
      </button>
    );
  }

  // ----- full -----
  return (
    <button
      onClick={toggle}
      disabled={pending}
      className={cn(
        "w-full rounded-xl py-3 text-sm font-bold transition-colors",
        following
          ? "bg-primary text-black"
          : "bg-card text-white hover:bg-secondary"
      )}
    >
      {following ? "✓ Following" : "Add to Watchlist"}
    </button>
  );
}
