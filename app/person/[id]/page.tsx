import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, Star } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { getLibraryState } from "@/lib/explore-digest";
import {
  getPersonDetails,
  getPersonMovieCredits,
  posterUrl,
  type TmdbPersonMovieCredit,
} from "@/lib/tmdb";
import { MovieWatchButton } from "@/components/movie-watch-button";
import { StickyChrome } from "@/components/sticky-chrome";

function score(v?: number) {
  if (v == null || v <= 0) return "–";
  return v.toFixed(1);
}

/** Best-first ranking: meaningful vote volume first (50+), then score,
 * then vote count, then popularity. Single-vote 10.0 shorts sink instead
 * of floating above real films. Nothing hidden — just ordered honestly. */
function rankCredits(list: TmdbPersonMovieCredit[]): TmdbPersonMovieCredit[] {
  return [...list]
    .filter((c) => c.title || c.name)
    .sort((a, b) => {
      const aw = (a.vote_count ?? 0) >= 50 ? 0 : 1;
      const bw = (b.vote_count ?? 0) >= 50 ? 0 : 1;
      if (aw !== bw) return aw - bw;
      const sa = a.vote_average ?? 0;
      const sb = b.vote_average ?? 0;
      if (sb !== sa) return sb - sa;
      const ca = a.vote_count ?? 0;
      const cb = b.vote_count ?? 0;
      if (cb !== ca) return cb - ca;
      return (b.popularity ?? 0) - (a.popularity ?? 0);
    });
}

function CreditCard({
  credit,
  role,
  status,
}: {
  credit: TmdbPersonMovieCredit;
  role?: string;
  status: string | null;
}) {
  const poster = posterUrl(credit.poster_path, "w342");
  const year = credit.release_date?.slice(0, 4);
  return (
    <div className="min-w-0">
      <Link
        href={`/movie/${credit.id}`}
        className="relative block aspect-[2/3] overflow-hidden rounded-md bg-card ring-1 ring-white/10"
      >
        {poster ? (
          <Image
            src={poster}
            alt={credit.title ?? credit.name ?? "Film"}
            fill
            sizes="(max-width: 480px) 33vw, 200px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs font-bold text-white/50">
            {credit.title ?? credit.name}
          </div>
        )}
      </Link>
      <Link href={`/movie/${credit.id}`} className="mt-1 block min-w-0">
        <p className="truncate text-xs font-bold text-white">
          {credit.title ?? credit.name}
        </p>
      </Link>
      <div className="mt-0.5 flex items-center justify-between gap-1">
        <span className="inline-flex min-w-0 items-center gap-0.5 text-[11px] font-semibold text-white/60">
          <Star className="h-3 w-3 shrink-0 fill-primary text-primary" />
          {score(credit.vote_average)}
          {year ? <span className="ml-1 truncate text-white/40">{year}</span> : null}
        </span>
        <MovieWatchButton
          tmdbId={credit.id}
          initialStatus={status}
          variant="compact"
        />
      </div>
      {role ? (
        <p className="mt-0.5 truncate text-[11px] text-white/40">{role}</p>
      ) : null}
    </div>
  );
}

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: raw } = await params;
  const personId = Number(raw);
  if (!Number.isFinite(personId)) notFound();

  const userId = await requireAuth();
  const [details, credits, library] = await Promise.all([
    getPersonDetails(personId).catch(() => null),
    getPersonMovieCredits(personId).catch(() => ({ cast: [], crew: [] })),
    getLibraryState(userId),
  ]);
  if (!details) notFound();

  const acting = rankCredits(credits.cast).slice(0, 30);
  const directing = rankCredits(
    credits.crew.filter((c) => c.job === "Director" || c.department === "Directing")
  ).slice(0, 12);
  const knownFor = acting.slice(0, 6);

  const photo = posterUrl(details.profile_path, "w500");
  const birthYear = details.birthday?.slice(0, 4);

  return (
    <div className="min-h-dvh bg-black pb-nav-page">
      <StickyChrome contentClassName="px-4 pt-2 pb-2">
        <div className="flex items-center gap-3">
          <Link
            href="/movies"
            aria-label="Back to movies"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">
              {details.known_for_department ?? "Filmography"}
            </p>
            <h1 className="truncate text-lg font-black text-white">
              {details.name}
            </h1>
          </div>
        </div>
      </StickyChrome>

      {/* Hero: photo + facts */}
      <div className="flex gap-4 px-4 pt-4">
        <div className="relative h-44 w-32 flex-shrink-0 overflow-hidden rounded-2xl bg-secondary ring-1 ring-white/15">
          {photo ? (
            <Image
              src={photo}
              alt={details.name}
              fill
              sizes="128px"
              className="object-cover"
              unoptimized
              priority
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-3xl font-black text-white/30">
              {details.name.charAt(0)}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 pt-1">
          {details.known_for_department ? (
            <p className="text-xs font-bold uppercase tracking-wider text-white/40">
              {details.known_for_department}
            </p>
          ) : null}
          {birthYear ? (
            <p className="mt-1 text-sm font-semibold text-white/70">
              Born {birthYear}
              {details.place_of_birth ? ` · ${details.place_of_birth}` : ""}
            </p>
          ) : details.place_of_birth ? (
            <p className="mt-1 text-sm font-semibold text-white/70">
              {details.place_of_birth}
            </p>
          ) : null}
          <p className="mt-1 text-sm font-semibold text-white/70">
            {acting.length} film{acting.length === 1 ? "" : "s"}
            {directing.length > 0 ? ` · ${directing.length} directed` : ""}
          </p>
          {knownFor.length > 0 ? (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-white/50">
              Known for {knownFor.map((c) => c.title ?? c.name).join(", ")}
            </p>
          ) : null}
        </div>
      </div>

      {/* Bio */}
      {details.biography ? (
        <section className="mt-5 px-4">
          <h2 className="mb-2 text-lg font-extrabold tracking-tight text-white">
            Biography
          </h2>
          <p className="line-clamp-6 text-sm leading-relaxed text-white/75">
            {details.biography}
          </p>
        </section>
      ) : null}

      {/* Directing first when they're a director */}
      {directing.length > 0 && (
        <section className="mt-6 px-4">
          <h2 className="mb-2.5 text-lg font-extrabold tracking-tight text-white">
            Directed
          </h2>
          <div className="grid grid-cols-3 gap-x-2 gap-y-4">
            {directing.map((c) => (
              <CreditCard
                key={`dir-${c.id}`}
                credit={c}
                status={library.movieStatusById.get(c.id) || null}
              />
            ))}
          </div>
        </section>
      )}

      <section className="mt-6 px-4 pb-4">
        <h2 className="mb-2.5 text-lg font-extrabold tracking-tight text-white">
          {directing.length > 0 ? "Acting" : "Filmography"}
        </h2>
        {acting.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No film credits found.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-x-2 gap-y-4">
            {acting.map((c) => (
              <CreditCard
                key={`cast-${c.id}-${c.character ?? ""}`}
                credit={c}
                role={c.character}
                status={library.movieStatusById.get(c.id) || null}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
