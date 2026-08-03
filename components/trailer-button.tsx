"use client";

import { useEffect, useState } from "react";
import { Play, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ▶ Trailer button + fullscreen YouTube modal (youtube-nocookie embed).
 * Renders nothing when no trailer key is available.
 */
export function TrailerButton({
  trailerKey,
  title,
  className,
}: {
  trailerKey: string | null;
  title: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!trailerKey) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-wide text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-white/20 active:scale-95",
          className
        )}
      >
        <Play className="h-3.5 w-3.5 fill-white" />
        Trailer
      </button>

      {open && (
        <div className="fixed inset-0 z-[90] flex flex-col bg-black/95 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close trailer"
            className="absolute inset-0"
            onClick={() => setOpen(false)}
          />
          <div className="pointer-events-none relative flex items-center justify-between px-4 pt-safe-float py-3">
            <p className="truncate text-sm font-bold text-white/80">{title}</p>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="pointer-events-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="relative flex flex-1 items-center justify-center px-3 pb-8">
            <div className="relative aspect-video w-full max-w-4xl overflow-hidden rounded-xl ring-1 ring-white/10">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${trailerKey}?autoplay=1&rel=0`}
                title={`${title} trailer`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
