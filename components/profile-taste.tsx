import Link from "next/link";
import { posterUrl } from "@/lib/tmdb";
import type { TasteSnapshot } from "@/lib/profile-insights";
import { scoreLabel } from "@/lib/profile-insights";

export function ProfileTaste({ taste }: { taste: TasteSnapshot }) {
  const hasScores =
    taste.avgShowScore != null ||
    taste.avgMovieScore != null ||
    taste.genres.length > 0 ||
    taste.topTitles.length > 0;

  if (!hasScores) {
    return (
      <div className="rounded-2xl bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        Rate episodes and movies to unlock your taste snapshot.
      </div>
    );
  }

  const maxGenre = Math.max(1, ...taste.genres.map((g) => g.count));

  return (
    <div className="space-y-4">
      {/* Score summary */}
      <div className="grid grid-cols-2 gap-2">
        <ScoreCard
          label="Your TV avg"
          value={
            taste.avgShowScore != null
              ? scoreLabel(taste.avgShowScore)
              : "—"
          }
          hint={
            taste.ratedEpisodes > 0
              ? `${taste.ratedEpisodes} rated ep${taste.ratedEpisodes === 1 ? "" : "s"}`
              : "No episode ratings yet"
          }
        />
        <ScoreCard
          label="Your movie avg"
          value={
            taste.avgMovieScore != null
              ? scoreLabel(taste.avgMovieScore)
              : "—"
          }
          hint={
            taste.ratedMovies > 0
              ? `${taste.ratedMovies} rated film${taste.ratedMovies === 1 ? "" : "s"}`
              : "No movie ratings yet"
          }
        />
      </div>

      {/* Genres */}
      {taste.genres.length > 0 && (
        <div className="rounded-2xl bg-card p-4">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Top genres
          </p>
          <div className="space-y-2.5">
            {taste.genres.map((g) => (
              <div key={g.name}>
                <div className="mb-0.5 flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-white">{g.name}</span>
                  <span className="text-muted-foreground">
                    {g.count}
                    {g.avgScore != null
                      ? ` · ${scoreLabel(g.avgScore)}`
                      : ""}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(g.count / maxGenre) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top rated posters */}
      {taste.topTitles.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Highest rated by you
          </p>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {taste.topTitles.map((t) => {
              const src = t.posterPath
                ? posterUrl(t.posterPath, "w185")
                : null;
              return (
                <Link
                  key={t.key}
                  href={t.href}
                  className="w-[5.25rem] shrink-0"
                >
                  <div className="relative h-[7.875rem] w-[5.25rem] overflow-hidden rounded-lg bg-[#2c2c2e]">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={src}
                        alt={t.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center p-1 text-center text-[10px] text-white">
                        {t.title}
                      </div>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[11px] font-semibold text-white">
                    {t.title}
                  </p>
                  <p className="truncate text-[10px] font-medium text-primary">
                    {t.scoreLabel}
                  </p>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl bg-card p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-primary">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
