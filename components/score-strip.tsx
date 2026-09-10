import { cn } from "@/lib/utils";
import { TmdbIcon } from "@/components/rt-icons";

/**
 * Horizontal strip of critic/audience scores for detail pages.
 * Renders only the scores that exist; hidden entirely when none do.
 * Uses the same emoji treatment as series detail (🍅 / 🍿) — the custom
 * SVG tomato/popcorn buckets rendered muddy at small sizes.
 */
export function ScoreStrip({
  rtScore,
  rtAudienceScore,
  voteAverage,
  className,
}: {
  rtScore?: number | null;
  rtAudienceScore?: number | null;
  voteAverage?: number | null;
  className?: string;
}) {
  const cells: {
    key: string;
    icon: React.ReactNode;
    value?: string;
    label: string;
  }[] = [];

  if (rtScore != null && rtScore >= 0) {
    cells.push({
      key: "rt",
      icon: (
        <span className="text-xl leading-none" title="Rotten Tomatoes">
          🍅
        </span>
      ),
      value: `${rtScore}%`,
      label: "Tomatometer",
    });
  }
  if (rtAudienceScore != null && rtAudienceScore >= 0) {
    cells.push({
      key: "aud",
      icon: (
        <span className="text-xl leading-none" title="Popcornmeter">
          🍿
        </span>
      ),
      value: `${rtAudienceScore}%`,
      label: "Popcornmeter",
    });
  }
  if (voteAverage != null && voteAverage > 0) {
    cells.push({
      key: "tmdb",
      icon: <TmdbIcon className="h-7 w-7" />,
      value: voteAverage.toFixed(1),
      label: "TMDB",
    });
  }

  if (cells.length === 0) return null;

  return (
    <div
      className={cn(
        "grid divide-x divide-white/[0.1] border-y border-white/[0.1] py-2",
        className
      )}
      style={{
        gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))`,
      }}
    >
      {cells.map((c) => (
        <div
          key={c.key}
          className="flex flex-col items-center gap-1 px-2 py-1.5"
        >
          <span className="[&>svg]:h-5 [&>svg]:w-5">{c.icon}</span>
          {c.value != null && (
            <p className="text-base font-black leading-none text-white">
              {c.value}
            </p>
          )}
          <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-white/35">
            {c.label}
          </p>
        </div>
      ))}
    </div>
  );
}
