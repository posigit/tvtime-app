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
            ? "bg-primary text-black ring-white/40 shadow-[0_8px_24px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.5)]"
            : "bg-white/[0.1] text-white ring-white/25 shadow-[0_8px_24px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.25)] hover:bg-white/20"
        )}
      >
        {queued ? (
          <Check className="h-4 w-4" strokeWidth={3} />
        ) : (
          <RotateCcw className="h-4 w-4" strokeWidth={2.5} />
        )}
        {count >= 2 ? (
          <span
            className={cn(
              "text-xs font-black",
              queued ? "text-black" : "text-success"
            )}
          >
            ×{count}
          </span>
        ) : (
          <span
            className={cn(
              "text-xs font-bold",
              queued ? "text-black" : "text-white/60"
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
            className="w-full max-w-sm rounded-2xl bg-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-1 text-lg font-black text-white">
              {queued ? "Queued for rewatch" : "Rewatch this?"}
            </p>
            <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
              {queued ? (
                <>
                  It&apos;s sitting in <b className="text-white">Watch Next</b>{" "}
                  with a Rewatch badge — screenshot away. Finish it to log{" "}
                  <b className="text-white">×{count + 1}</b>, or log it now.
                </>
              ) : (
                <>
                  <b className="text-white">Plan it</b> to resurface in Watch
                  Next (rating + history stay), or{" "}
                  <b className="text-white">log it now</b> if you just finished
                  it{count >= 1 ? ` — badge becomes ×${count + 1}` : ""}.
                </>
              )}
            </p>
            <div className="space-y-2">
              {!queued && (
                <button
                  type="button"
                  onClick={() => run("queue")}
                  disabled={pendingMode !== null}
                  className="flex w-full items-center gap-3 rounded-xl bg-primary px-4 py-3 text-left text-sm font-black text-black disabled:opacity-50"
                >
                  <BookmarkPlus className="h-5 w-5" strokeWidth={2.5} />
                  <span>
                    Plan rewatch
                    <span className="block text-[11px] font-semibold text-black/60">
                      Back to Watch Next · no date stamped
                    </span>
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => run("log")}
                disabled={pendingMode !== null}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-bold",
                  queued
                    ? "bg-primary text-black"
                    : "bg-secondary text-white hover:bg-white/10"
                )}
              >
                <History className="h-5 w-5" strokeWidth={2.5} />
                <span>
                  {pendingMode === "log" ? "Logging…" : "Log rewatch now"}
                  <span
                    className={cn(
                      "block text-[11px] font-semibold",
                      queued ? "text-black/60" : "text-white/50"
                    )}
                  >
                    Stamps today · resume resets · ×{count + 1}
                  </span>
                </span>
              </button>
              {queued && (
                <button
                  type="button"
                  onClick={() => run("unqueue")}
                  disabled={pendingMode !== null}
                  className="w-full rounded-full border border-white/20 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Remove from queue
                </button>
              )}
              {!queued && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={pendingMode !== null}
                  className="w-full rounded-full border border-white/20 py-3 text-sm font-medium text-white"
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
