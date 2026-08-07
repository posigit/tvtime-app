"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { useToast } from "@/components/toast";

/**
 * Movie rewatch toggle. Visible only when the movie is marked watched.
 * Clears the resume bookmark (replay from top) and appends a new entry to the
 * watch-history log so the rewatch date is kept alongside the first watch.
 */
export function MovieRewatchButton({
  tmdbId,
  initialCount,
}: {
  tmdbId: number;
  initialCount: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [count, setCount] = useState(initialCount);

  const start = async () => {
    setPending(true);
    try {
      const res = await fetch("/api/movie-rewatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId }),
      });
      if (!res.ok) throw new Error("rewatch failed");
      const data = await res.json();
      setCount(Number(data.count ?? count + 1));
      toast("Rewatch started — starting from the top");
      router.refresh();
    } catch {
      toast("Couldn't start rewatch — try again", "error");
    } finally {
      setPending(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={pending}
        aria-label="Rewatch movie"
        title="Rewatch movie"
        className="flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full bg-card px-3 text-white ring-1 ring-white/15 transition-colors hover:bg-secondary disabled:opacity-50"
      >
        <RotateCcw className="h-4 w-4" strokeWidth={2.5} />
        {count > 0 ? (
          <span className="text-xs font-bold text-success">×{count}</span>
        ) : (
          <span className="text-xs font-bold text-white/60">Rewatch</span>
        )}
      </button>
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6">
            <p className="mb-2 text-lg font-bold text-white">Rewatch?</p>
            <p className="mb-6 text-sm text-muted-foreground">
              Your resume point clears so it plays from the top. Rating and
              watch history stay. Your rewatch badge becomes ×{count + 1}.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                className="flex-1 rounded-full border border-white/20 py-3 text-sm font-medium text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={start}
                disabled={pending}
                className="flex-1 rounded-full bg-success py-3 text-sm font-bold text-white"
              >
                Rewatch
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}