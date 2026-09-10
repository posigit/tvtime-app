"use client";

import { Heart, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared Letterboxd-style poster badges.
 *
 * - Favorite: red heart that "leaks" off the top-right corner. Parents MUST be
 *   `overflow-visible` (put rounding/clipping on an inner image wrapper) or
 *   the negative offset gets clipped.
 * - Rewatch: bottom-right pill `⟳ ×N` in success green. `count` = total
 *   watchHistory completions; shown when >= 2 (i.e. at least one rewatch), or
 *   when the title is queued for rewatch (shows `Queued` instead).
 */
export function FavoriteHeart({ className }: { className?: string }) {
  return (
    <span
      aria-label="Favorite"
      title="Favorite"
      className={cn(
        "pointer-events-none absolute -right-2 -top-2 z-20 flex h-7 w-7 rotate-12 items-center justify-center rounded-full bg-[#e0202e] shadow-[0_2px_10px_rgba(0,0,0,0.55)] ring-2 ring-black",
        className
      )}
    >
      <Heart className="h-3.5 w-3.5 fill-white text-white" strokeWidth={2.5} />
    </span>
  );
}

export function RewatchBadge({
  count,
  queued,
  className,
}: {
  /** Total completions (first watch + rewatches). */
  count?: number | null;
  queued?: boolean;
  className?: string;
}) {
  if (!queued && (count == null || count < 2)) return null;
  return (
    <span
      aria-label={queued ? "Queued for rewatch" : `Rewatched ${count} times`}
      title={queued ? "Queued for rewatch" : `Watched ${count}×`}
      className={cn(
        "pointer-events-none absolute bottom-1 right-1 z-10 flex items-center gap-1 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-black leading-none backdrop-blur-sm",
        queued ? "text-primary" : "text-success",
        className
      )}
    >
      <RotateCcw className="h-2.5 w-2.5" strokeWidth={3} />
      {queued && (count == null || count < 2) ? "Queued" : `×${count}`}
    </span>
  );
}

/** Both badges at once — drop inside a relative, overflow-visible wrapper. */
export function PosterBadges({
  favorite,
  rewatchCount,
  rewatchQueued,
}: {
  favorite?: boolean | null;
  rewatchCount?: number | null;
  rewatchQueued?: boolean | null;
}) {
  return (
    <>
      {favorite ? <FavoriteHeart /> : null}
      <RewatchBadge count={rewatchCount} queued={!!rewatchQueued} />
    </>
  );
}
