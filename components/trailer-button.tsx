import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ▶ Trailer link — opens YouTube directly (YouTube app on phones).
 * Plain anchor: no modal, no embed, nothing to stutter.
 * Renders nothing when no trailer key is available.
 * Liquid-glass pill so it sits cleanly over artwork.
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
  if (!trailerKey) return null;

  return (
    <a
      href={`https://www.youtube.com/watch?v=${trailerKey}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Watch ${title} trailer on YouTube`}
      className={cn(
        "flex items-center gap-1.5 rounded-full bg-white/[0.14] px-4 py-2 text-xs font-black uppercase tracking-wide text-white ring-1 ring-white/30 shadow-[0_8px_24px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur-xl transition hover:bg-white/25 active:scale-95",
        className
      )}
    >
      <Play className="h-3.5 w-3.5 fill-white" />
      Trailer
    </a>
  );
}
