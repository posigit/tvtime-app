"use client";

import { X } from "lucide-react";

/**
 * Shown when a played episode ends and there's no next aired episode
 * (series finale, or the show is waiting for next week's episode).
 * The player stays open so the finale plays to the true end; this card
 * gives the user an explicit "done" affordance instead of the missing
 * Up Next card (which only renders when a next episode exists).
 */
export function EndOfLineCard({
  showTitle,
  seasonNumber,
  episodeNumber,
  episodeTitle,
  onClose,
}: {
  showTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle?: string | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-end p-5 sm:items-start sm:p-6">
      <div className="w-full max-w-xs overflow-hidden rounded-2xl border border-white/10 bg-card/95 shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between gap-2 px-4 pt-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
              End of the line
            </p>
            <p className="mt-1 truncate text-sm font-bold text-white">
              {episodeTitle ??
                `${showTitle} — S${seasonNumber}E${episodeNumber}`}
            </p>
            <p className="mt-0.5 text-xs text-white/50">
              That&apos;s the latest aired episode — no new episode yet.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full border-t border-white/10 px-4 py-3 text-center text-sm font-bold text-white transition hover:bg-secondary"
        >
          Done
        </button>
      </div>
    </div>
  );
}
