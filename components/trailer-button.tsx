import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ▶ Trailer link — opens YouTube directly (YouTube app on phones).
 * Plain anchor: no modal, no embed, nothing to stutter.
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
  if (!trailerKey) return null;

  return (
    <a
      href={`https://www.youtube.com/watch?v=${trailerKey}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Watch ${title} trailer on YouTube`}
      className={cn(
        "flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-wide text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-white/20 active:scale-95",
        className
      )}
    >
      <Play className="h-3.5 w-3.5 fill-white" />
      Trailer
    </a>
  );
}
