import {
  dayKey,
  heatLevel,
  lastNDayKeys,
  type DayCount,
} from "@/lib/profile-insights";
import { cn } from "@/lib/utils";

const LEVEL_CLASS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "bg-white/5",
  1: "bg-primary/25",
  2: "bg-primary/45",
  3: "bg-primary/70",
  4: "bg-primary",
};

/**
 * Contribution-style heatmap for the last ~26 weeks of watch activity.
 * Pure server component — no client JS.
 */
export function ProfileHeatmap({
  dayCounts,
  currentStreak,
  longestStreak,
  days = 182,
}: {
  dayCounts: DayCount[];
  currentStreak: number;
  longestStreak: number;
  /** How many days to show (default ~6 months). */
  days?: number;
}) {
  const countByDay = new Map(dayCounts.map((d) => [d.day, d.count]));
  const keys = lastNDayKeys(days);
  const max = Math.max(1, ...keys.map((k) => countByDay.get(k) ?? 0));

  // Pad so grid starts on Sunday (columns = weeks)
  const first = new Date(keys[0] + "T12:00:00");
  const pad = first.getDay(); // 0 = Sun
  const cells: { key: string | null; count: number }[] = [];
  for (let i = 0; i < pad; i++) cells.push({ key: null, count: 0 });
  for (const k of keys) {
    cells.push({ key: k, count: countByDay.get(k) ?? 0 });
  }

  const weeks: { key: string | null; count: number }[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  const totalActive = keys.filter((k) => (countByDay.get(k) ?? 0) > 0).length;

  return (
    <div className="rounded-2xl bg-card p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Watch activity
          </p>
          <p className="mt-0.5 text-sm text-white/80">
            <span className="font-bold text-white">{totalActive}</span> active
            days · last {Math.round(days / 30)} mo
          </p>
        </div>
        <div className="flex gap-3 text-[11px] text-muted-foreground">
          <span>
            Now{" "}
            <span className="font-bold text-[#f5a623]">{currentStreak}d</span>
          </span>
          <span>
            Best{" "}
            <span className="font-bold text-white">{longestStreak}d</span>
          </span>
        </div>
      </div>

      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="inline-flex gap-0.5">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-0.5">
              {week.map((cell, di) => {
                if (!cell.key) {
                  return (
                    <div
                      key={`pad-${wi}-${di}`}
                      className="h-2.5 w-2.5 rounded-[2px] bg-transparent"
                    />
                  );
                }
                const level = heatLevel(cell.count, max);
                return (
                  <div
                    key={cell.key}
                    title={`${cell.key}: ${cell.count} watch${cell.count === 1 ? "" : "es"}`}
                    className={cn(
                      "h-2.5 w-2.5 rounded-[2px]",
                      LEVEL_CLASS[level],
                      cell.key === dayKey(new Date()) && "ring-1 ring-white/40"
                    )}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
        <span>Less</span>
        {([0, 1, 2, 3, 4] as const).map((l) => (
          <div
            key={l}
            className={cn("h-2.5 w-2.5 rounded-[2px]", LEVEL_CLASS[l])}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
