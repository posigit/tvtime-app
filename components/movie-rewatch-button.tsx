"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, Check, History, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/toast";

/**
 * Letterboxd-style movie rewatch control. Visible only when watched.
 *
 * Two intents, one button:
 * - "Plan rewatch" (queue): stays watched, sets rewatch_queued → resurfaces in
 *   Watch Next so it can be screenshotted/planned. No history row.
 * - "Log rewatch now": clears resume, appends watchHistory, clears the queue.
 */
export function MovieRewatchButton({
  tmdbId,
  initialCount,
  initialQueued,
}: {
  tmdbId: number;
  initialCount: number;
  initialQueued?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState<string | null>(null);
  const [count, setCount] = useState(initialCount);
  const [queued, setQueued] = useState(!!initialQueued);

  const run = async (mode: "queue" | "log" | "unqueue") => {
    setPendingMode(mode);
    try {
      const res = await fetch("/api/movie-rewatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId, mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "rewatch failed");
      if (mode === "queue") {
        setQueued(true);
        if (typeof data.count === "number") setCount(Number(data.count));
        try {
          navigator.vibrate?.(15);
        } catch {
          /* ignore */
        }
        toast(
          data?.queuedFallback
            ? "Marked for rewatch (list sync pending)"
            : "Queued for rewatch — in Watch Next"
        );
      } else if (mode === "unqueue") {
        setQueued(false);
        toast("Removed from rewatch queue", "info");
      } else {
        setQueued(false);
        setCount(Number(data.count ?? count + 1));
        try {
          navigator.vibrate?.(15);
        } catch {
          /* ignore */
        }
        toast(`Rewatch logged${data.count >= 5 ? " — certified classic!" : ""}`);
      }
      router.refresh();
    } catch {
      toast("Couldn't update rewatch — try again", "error");
    } finally {
      setPendingMode(null);
      setOpen(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pendingMode !== null}
        aria-label={queued ? "Queued for rewatch" : "Rewatch movie"}
        title={queued ? "Queued for rewatch" : "Rewatch movie"}
        className={cn(
          "flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full px-3 ring-1 backdrop-blur-xl transition-all active:scale-95 disabled:opacity-50",
          queued
            ? "bg-gradient-to-b from-white/25 via-white/[0.12] to-white/[0.06] text-white ring-white/45 shadow-[0_8px_24px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.45)]"
            : "bg-white/[0.1] text-white ring-white/25 shadow-[0_8px_24px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.25)] hover:bg-white/20"
        )}
      >
        {queued ? (
          <Check
            className="h-4 w-4 text-primary drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
            strokeWidth={3.5}
          />
        ) : (
          <RotateCcw className="h-4 w-4" strokeWidth={2.5} />
        )}
        {count >= 2 ? (
          <span className="text-xs font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
            ×{count}
          </span>
        ) : (
          <span
            className={cn(
              "text-xs font-bold",
              queued
                ? "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
                : "text-white/60"
            )}
          >
            {queued ? "Queued" : "Rewatch"}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-4 sm:items-center"
          onClick={() => pendingMode === null && setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-[1.75rem] bg-[#1c1c1e]/80 p-5 shadow-[0_24px_64px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.12)] ring-1 ring-white/15 backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-4 text-lg font-black text-white">
              {queued ? "Queued for rewatch" : "Rewatch this?"}
            </p>
            <div className="space-y-2">
              {!queued && (
                <button
                  type="button"
                  onClick={() => run("queue")}
                  disabled={pendingMode !== null}
                  className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.12] px-4 py-3.5 text-left text-sm font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] ring-1 ring-white/25 backdrop-blur-xl transition active:scale-[0.99] hover:bg-white/[0.18] disabled:opacity-50"
                >
                  <BookmarkPlus
                    className="h-5 w-5 shrink-0 text-primary"
                    strokeWidth={2.5}
                  />
                  {pendingMode === "queue" ? "Planning…" : "Plan rewatch"}
                </button>
              )}
              <button
                type="button"
                onClick={() => run("log")}
                disabled={pendingMode !== null}
                className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.07] px-4 py-3.5 text-left text-sm font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] ring-1 ring-white/15 backdrop-blur-xl transition active:scale-[0.99] hover:bg-white/[0.12] disabled:opacity-50"
              >
                <History
                  className="h-5 w-5 shrink-0 text-white/80"
                  strokeWidth={2.5}
                />
                {pendingMode === "log" ? "Logging…" : "Log rewatch now"}
              </button>
              {queued && (
                <button
                  type="button"
                  onClick={() => run("unqueue")}
                  disabled={pendingMode !== null}
                  className="w-full rounded-full py-3 text-sm font-semibold text-white/60 transition hover:text-white disabled:opacity-50"
                >
                  {pendingMode === "unqueue"
                    ? "Removing…"
                    : "Remove from queue"}
                </button>
              )}
              {!queued && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={pendingMode !== null}
                  className="w-full rounded-full py-2.5 text-sm font-medium text-white/60 transition hover:text-white"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
