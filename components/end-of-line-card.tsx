"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/**
 * Shown when a played episode ends and there's no next aired episode
 * (series finale, or the show is waiting for next week's episode).
 *
 * Small + sleek: bottom-right, auto-dismisses after ~4s, and the X only
 * closes THIS card — the player stays open so the user finishes the
 * finale and closes the player themselves.
 */
export function EndOfLineCard({
  episodeLabel,
  onDismiss,
}: {
  episodeLabel: string;
  onDismiss: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  // Latest handler via ref so the auto-dismiss timer runs exactly once on
  // mount (a changing onDismiss identity must not reset the 4s countdown).
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setLeaving(true);
      window.setTimeout(() => onDismissRef.current(), 250);
    }, 4000);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[110] flex justify-end p-4 pb-5">
      <div
        className={`pointer-events-auto flex items-center gap-2.5 rounded-full border border-white/10 bg-black/80 py-2 pl-4 pr-2 shadow-2xl backdrop-blur transition-all duration-250 ${
          leaving ? "translate-y-2 opacity-0" : "translate-y-0 opacity-100"
        }`}
      >
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
            End of the line
          </p>
          <p className="max-w-[200px] truncate text-xs text-white/80">
            {episodeLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLeaving(true);
            window.setTimeout(() => onDismissRef.current(), 250);
          }}
          aria-label="Dismiss"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
