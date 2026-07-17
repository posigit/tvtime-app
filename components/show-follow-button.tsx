"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";

export function ShowFollowButton({
  tmdbId,
  initialFollowing,
  compact,
}: {
  tmdbId: number;
  initialFollowing: boolean;
  compact?: boolean;
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
      } catch (err) {
        setFollowing(following);
      }
    });
  };

  return (
    <button
      onClick={toggle}
      disabled={pending}
      className={cn(
        "rounded-xl font-bold transition-colors",
        compact ? "px-2 py-1 text-[10px]" : "w-full py-3 text-sm",
        following
          ? "bg-primary text-black"
          : "bg-card text-white hover:bg-secondary"
      )}
    >
      {following ? (compact ? "✓" : "✓ Following") : compact ? "+" : "Add to Watchlist"}
    </button>
  );
}
