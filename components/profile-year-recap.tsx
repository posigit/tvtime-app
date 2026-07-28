import { posterUrl } from "@/lib/tmdb";
import type { YearRecap } from "@/lib/profile-insights";

function splitDuration(totalMinutes: number) {
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  return { days, hours };
}

export function ProfileYearRecap({ recap }: { recap: YearRecap }) {
  const totalMin = recap.tvMinutes + recap.movieMinutes;
  const { days, hours } = splitDuration(totalMin);
  const hasActivity =
    recap.episodes > 0 || recap.movies > 0 || recap.activeDays > 0;

  if (!hasActivity) {
    return (
      <div className="rounded-2xl bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        No watches logged in {recap.year} yet — go start a streak.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-primary/20 via-card to-card">
      <div className="border-b border-white/5 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary">
          Year in review
        </p>
        <h3 className="text-2xl font-black text-white">{recap.year}</h3>
      </div>

      <div className="grid grid-cols-2 gap-3 p-4">
        <Metric label="Episodes" value={recap.episodes.toLocaleString()} />
        <Metric label="Movies" value={recap.movies.toLocaleString()} />
        <Metric
          label="Time watched"
          value={
            days > 0
              ? `${days}d ${hours}h`
              : `${hours}h`
          }
        />
        <Metric label="Active days" value={String(recap.activeDays)} />
      </div>

      {(recap.topShow || recap.topMovie || recap.topGenre) && (
        <div className="space-y-3 border-t border-white/5 px-4 py-4">
          {recap.topGenre && (
            <p className="text-sm text-white/80">
              Top genre:{" "}
              <span className="font-bold text-white">{recap.topGenre}</span>
            </p>
          )}
          <div className="flex gap-3">
            {recap.topShow && (
              <Highlight
                kind="Most watched (real days)"
                title={recap.topShow.title}
                posterPath={recap.topShow.posterPath}
                sub={`${recap.topShow.episodes} ep${recap.topShow.episodes === 1 ? "" : "s"} logged`}
              />
            )}
            {recap.topMovie && (
              <Highlight
                kind="Highest rated movie"
                title={recap.topMovie.title}
                posterPath={recap.topMovie.posterPath}
                sub={
                  recap.topMovie.rating != null
                    ? `★ ${(recap.topMovie.rating / 2).toFixed(1)}`
                    : "Watched"
                }
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-xl font-bold text-white">{value}</p>
    </div>
  );
}

function Highlight({
  kind,
  title,
  posterPath,
  sub,
}: {
  kind: string;
  title: string;
  posterPath: string | null;
  sub: string;
}) {
  const src = posterPath ? posterUrl(posterPath, "w185") : null;
  return (
    <div className="flex min-w-0 flex-1 gap-2">
      <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded-md bg-[#2c2c2e]">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
          {kind}
        </p>
        <p className="truncate text-sm font-semibold text-white">{title}</p>
        <p className="text-[11px] text-primary">{sub}</p>
      </div>
    </div>
  );
}
