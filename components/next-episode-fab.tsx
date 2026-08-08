"use client";

import { SkipForward } from "lucide-react";

/**
 * Non-blocking liquid-glass Next control. Icon-only so it stays out of the
 * center of the frame; parent decides when to show (e.g. ≥96% after cancel).
 */
export function NextEpisodeFab({
  onNext,
  label = "Next episode",
}: {
  onNext: () => void;
  label?: string;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[110] flex justify-end p-3 pb-5 sm:p-5">
      <button
        type="button"
        onClick={onNext}
        aria-label={label}
        className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/25 bg-white/15 text-white shadow-lg shadow-black/40 backdrop-blur-xl transition hover:bg-white/25 active:scale-95"
      >
        <SkipForward className="h-5 w-5 fill-white/90" strokeWidth={2} />
      </button>
    </div>
  );
}
