import { History, RotateCcw } from "lucide-react";

function formatDiaryDate(d: Date): string {
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Letterboxd-diary style: "Watched ×3 · Aug 30 · Sep 4" — last-3 chips only. */
export function MovieDiaryLine({
  dates,
}: {
  /** watchHistory watchedAt values, newest-first. */
  dates: Date[];
}) {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort((a, b) => b.getTime() - a.getTime());
  const count = sorted.length;

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 px-1">
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-white/60">
        {count >= 2 ? (
          <RotateCcw className="h-3 w-3 text-success" strokeWidth={3} />
        ) : (
          <History className="h-3 w-3" />
        )}
        {count >= 2 ? `Watched ×${count}` : "Watched once"}
      </span>
      <span className="text-[11px] text-white/30">·</span>
      {sorted.slice(0, 3).map((d, i) => (
        <span
          key={`${d.getTime()}-${i}`}
          className={
            i === 0
              ? "rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success"
              : "rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold text-white/50"
          }
        >
          {i === 0 && count >= 2 ? `⟳ ${formatDiaryDate(d)}` : formatDiaryDate(d)}
        </span>
      ))}
    </div>
  );
}
