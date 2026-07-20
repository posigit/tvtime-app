"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

/** White filled circle check button (snapshot 1/2 style) */
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
        "flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white text-black transition-transform active:scale-90",
        loading && "opacity-60"
      )}
      aria-label="Mark as watched"
    >
      <Check className="h-5 w-5" strokeWidth={3} />
    </button>
  );
}
