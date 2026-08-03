import { cn } from "@/lib/utils";
import {
  FreshIcon,
  RottenIcon,
  PopcornIcon,
  MetacriticIcon,
} from "@/components/rt-icons";

/**
 * Horizontal strip of critic/audience scores for detail pages.
 * Renders only the scores that exist; hidden entirely when none do.
 */
export function ScoreStrip({
  rtScore,
  rtAudienceScore,
  mcScore,
  voteAverage,
  className,
}: {
  rtScore?: number | null;
  rtAudienceScore?: number | null;
  mcScore?: number | null;
  voteAverage?: number | null;
  className?: string;
}) {
  const cells: {
    key: string;
    icon: React.ReactNode;
    value: string;
    label: string;
  }[] = [];

  if (rtScore != null && rtScore >= 0) {
    cells.push({
      key: "rt",
      icon:
        rtScore >= 60 ? (
          <FreshIcon className="h-7 w-7" />
        ) : (
          <RottenIcon className="h-7 w-7" />
        ),
      value: `${rtScore}%`,
      label: "Tomatometer",
    });
  }
  if (rtAudienceScore != null && rtAudienceScore >= 0) {
    cells.push({
      key: "aud",
      icon: <PopcornIcon className="h-7 w-7" />,
      value: `${rtAudienceScore}%`,
      label: "Popcornmeter",
    });
  }
  if (mcScore != null && mcScore >= 0) {
    cells.push({
      key: "mc",
      icon: <MetacriticIcon className="h-7 w-7" score={mcScore} />,
      value: `${mcScore}`,
      label: "Metacritic",
    });
  }
  if (voteAverage != null && voteAverage > 0) {
    cells.push({
      key: "tmdb",
      icon: (
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-sm font-black text-black">
          T
        </span>
      ),
      value: voteAverage.toFixed(1),
      label: "TMDB",
    });
  }

  if (cells.length === 0) return null;

  return (
    <div
      className={cn(
        "grid gap-px overflow-hidden rounded-2xl bg-white/[0.07] ring-1 ring-white/[0.07]",
        className
      )}
      style={{
        gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))`,
      }}
    >
      {cells.map((c) => (
        <div
          key={c.key}
          className="flex flex-col items-center gap-1.5 bg-[#101011] px-2 py-3.5"
        >
          {c.icon}
          <p className="text-lg font-black leading-none text-white">
            {c.value}
          </p>
          <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">
            {c.label}
          </p>
        </div>
      ))}
    </div>
  );
}
