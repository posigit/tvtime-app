"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Heart } from "lucide-react";
import { useToast } from "@/components/toast";

/**
 * Compact favorite toggle (round heart icon). Persists via /api/favorite.
 * Rendered only once the user has actually watched/consumed the title.
 */
export function FavoriteButton({
  mediaType,
  tmdbId,
  initialFavorite,
}: {
  mediaType: "movie" | "tv";
  tmdbId: number;
  initialFavorite: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [favorite, setFavorite] = useState(initialFavorite);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next = !favorite;
    const prev = favorite;
    setFavorite(next);
    try {
      navigator.vibrate?.(10);
    } catch {
      /* ignore */
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/favorite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mediaType, tmdbId, favorite: next }),
        });
        if (!res.ok) throw new Error("favorite failed");
        toast(next ? "Added to favorites" : "Removed from favorites");
        router.refresh();
      } catch {
        setFavorite(prev);
        toast("Couldn't save — try again", "error");
      }
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
      title={favorite ? "Remove from favorites" : "Add to favorites"}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:opacity-50",
        favorite
          ? "bg-primary text-black"
          : "bg-black/60 text-white ring-1 ring-white/20 backdrop-blur hover:bg-black/80"
      )}
    >
      <Heart
        className="h-4 w-4"
        strokeWidth={favorite ? 2.5 : 2}
        fill={favorite ? "currentColor" : "none"}
      />
    </button>
  );
}