"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function MarkWatchedButton({
  showTmdbId,
  seasonNumber,
  episodeNumber,
}: {
  showTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          showTmdbId,
          seasonNumber,
          episodeNumber,
          watched: true,
        }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        console.error("Failed to mark episode watched");
      }
    } catch (err) {
      console.error("Error marking episode watched:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={cn(
        "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 border-white/30 text-white transition-colors active:bg-white active:text-black",
        loading && "opacity-50"
      )}
      aria-label="Mark as watched"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </button>
  );
}
