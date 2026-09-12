import { requireAuth } from "@/lib/auth";
import { db, withDbRetry } from "@/lib/db";
import { userMovies, watchHistory, movieReactions } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import {
  backdropUrl,
  posterUrl,
  logoUrl,
  getMovieCredits,
  getMovieDetails,
  getMovieImages,
  getMovieRecommendations,
  getMovieReleaseDates,
  getMovieSimilar,
  getMovieVideos,
  getWatchProviders,
  movieDirectors,
  pickCertification,
  pickMovieLogo,
  pickTrailerKey,
} from "@/lib/tmdb";
import { getCommunityReviews } from "@/lib/reviews";
import { ensureMovie } from "@/lib/ensure";
import { getMovieTheme } from "@/lib/movie-theme";
import { filterNewMedia } from "@/lib/recommend";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Play,
  ShieldAlert,
  Star,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { MovieWatchButton } from "@/components/movie-watch-button";
import { FavoriteButton } from "@/components/favorite-button";
import { AddToListButton } from "@/components/add-to-list-button";
import { MovieRewatchButton } from "@/components/movie-rewatch-button";
import { MovieDiaryLine } from "@/components/movie-diary-line";
// import { ReactionPicker } from "@/components/reaction-picker"; // hidden for now
import { MovieRating } from "@/components/star-rating";
import { DiscoverRail } from "@/components/discover-rail";
import { WatchProviders } from "@/components/watch-providers";
import { CommunityReviews } from "@/components/community-reviews";
import { ScoreStrip } from "@/components/score-strip";
import { MovieVixButton } from "@/components/movie-vix-button";
import { DownloadButton } from "@/components/download-button";
import { getPlaybackPosition } from "@/lib/playback";

function formatRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Genre names from the cached TMDB details JSON (tmdb_data.genres). */
function genresFromTmdbData(tmdbData: unknown): string[] {
  if (!tmdbData || typeof tmdbData !== "object") return [];
  const genres = (tmdbData as { genres?: unknown }).genres;
  if (!Array.isArray(genres)) return [];
  return genres
    .map((g) =>
      g && typeof g === "object" && "name" in g
        ? String((g as { name: unknown }).name)
        : ""
    )
    .filter((name) => name.length > 0)
    .slice(0, 5);
}

/** Safe accessor for fields on the cached tmdb_data JSON blob. */
function tmdbField<T>(tmdbData: unknown, key: string): T | null {
  if (!tmdbData || typeof tmdbData !== "object") return null;
  const value = (tmdbData as Record<string, unknown>)[key];
  return (value ?? null) as T | null;
}

function formatReleaseDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMoneyShort(n: number | null | undefined): string | null {
  if (n == null || n <= 0) return null;
  if (n >= 1_000_000_000)
    return `$${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1_000_000)
    return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${n}`;
}

function formatMoneyFull(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function languageName(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "language" }).of(code) ??
      code.toUpperCase()
    );
  } catch {
    return code.toUpperCase();
  }
}

export default async function MovieDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tmdbId = Number(id);
  if (!Number.isFinite(tmdbId)) notFound();

  const userId = await requireAuth();

  const movie = await ensureMovie(tmdbId);
  if (!movie) notFound();

  const loadUserMovie = async () => {
    try {
      return await withDbRetry(() =>
        db.query.userMovies.findFirst({
          where: and(eq(userMovies.userId, userId), eq(userMovies.tmdbId, tmdbId)),
        })
      );
    } catch {
      // Pre-migration DB without rewatch_queued — select without the column.
      const [row] = await withDbRetry(() =>
        db
          .select({
            userId: userMovies.userId,
            tmdbId: userMovies.tmdbId,
            status: userMovies.status,
            favorite: userMovies.favorite,
            watchedAt: userMovies.watchedAt,
            rating: userMovies.rating,
            updatedAt: userMovies.updatedAt,
          })
          .from(userMovies)
          .where(
            and(eq(userMovies.userId, userId), eq(userMovies.tmdbId, tmdbId))
          )
          .limit(1)
      ).catch(() => [null] as const);
      return row ?? null;
    }
  };

  const [userMovie, ownedMovies, playback, movieHistoryRows, movieReactionRows] =
    await Promise.all([
      loadUserMovie(),
      db
        .select({ tmdbId: userMovies.tmdbId })
        .from(userMovies)
        .where(eq(userMovies.userId, userId)),
      getPlaybackPosition(userId, "movie", tmdbId),
      db
        .select({ watchedAt: watchHistory.watchedAt })
        .from(watchHistory)
        .where(
          and(
            eq(watchHistory.userId, userId),
            eq(watchHistory.mediaType, "movie"),
            eq(watchHistory.tmdbId, tmdbId)
          )
        ),
      db
        .select({ reactionKey: movieReactions.reactionKey })
        .from(movieReactions)
        .where(
          and(eq(movieReactions.userId, userId), eq(movieReactions.tmdbId, tmdbId))
        ),
    ]);
  const movieRewatchCount = movieHistoryRows.length;
  const diaryDates = movieHistoryRows
    .map((r) => r.watchedAt)
    .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
  const userMovieRow = (userMovie ?? null) as
    | (NonNullable<typeof userMovie> & { rewatchQueued?: boolean | null })
    | null;
  const isRewatchQueued = userMovieRow?.rewatchQueued === true;

  const ownedIds = new Set(ownedMovies.map((m) => m.tmdbId));
  const movieReactionKeys = movieReactionRows.map((r) => r.reactionKey);

  const [
    similarRaw,
    recsRaw,
    providers,
    credits,
    reviews,
    videos,
    details,
    images,
    releaseDates,
    theme,
  ] = await Promise.all([
    getMovieSimilar(tmdbId).catch(() => []),
    getMovieRecommendations(tmdbId).catch(() => []),
    getWatchProviders(tmdbId, "movie").catch(() => ({
      flatrate: [],
      rent: [],
      buy: [],
    })),
    getMovieCredits(tmdbId).catch(() => null),
    getCommunityReviews({
      kind: "movie",
      tmdbId,
      title: movie.title,
      year: movie.releaseDate,
      knownRtScore: movie.rtScore,
      knownRtAudienceScore: movie.rtAudienceScore,
      knownMcScore: movie.mcScore,
    }).catch(() => ({
      reviews: [],
      rtScore: movie.rtScore != null && movie.rtScore >= 0 ? movie.rtScore : null,
      rtAudienceScore:
        movie.rtAudienceScore != null && movie.rtAudienceScore >= 0
          ? movie.rtAudienceScore
          : null,
      mcScore: movie.mcScore != null && movie.mcScore >= 0 ? movie.mcScore : null,
      rtState: null,
      rtUrl: null,
      counts: { all: 0, rt: 0, tmdb: 0, reddit: 0, fresh: 0, rotten: 0 },
    })),
    getMovieVideos(tmdbId).catch(() => []),
    getMovieDetails(tmdbId).catch(() => null),
    getMovieImages(tmdbId).catch(() => ({ logos: [] })),
    getMovieReleaseDates(tmdbId).catch(() => []),
    getMovieTheme(movie.posterPath, movie.backdropPath),
  ]);

  const moreLikeThis = filterNewMedia(similarRaw, ownedIds, 12);
  const recommended = filterNewMedia(recsRaw, ownedIds, 12);
  const directors = movieDirectors(credits?.crew);
  const directorLabel = directors.length > 0 ? directors.join(", ") : null;
  const cast = (credits?.cast ?? []).slice(0, 12);

  // Fresh details first, cached tmdb_data as fallback for older rows.
  const genres =
    details?.genres?.map((g) => g.name).filter(Boolean).slice(0, 5) ??
    genresFromTmdbData(movie.tmdbData);
  const tagline =
    details?.tagline || tmdbField<string>(movie.tmdbData, "tagline") || null;
  const budget =
    details?.budget ?? tmdbField<number>(movie.tmdbData, "budget") ?? 0;
  const revenue =
    details?.revenue ?? tmdbField<number>(movie.tmdbData, "revenue") ?? 0;
  const studios =
    details?.production_companies ??
    tmdbField<
      { id: number; name: string; logo_path?: string | null; origin_country?: string }[]
    >(movie.tmdbData, "production_companies") ??
    [];
  const status = movie.status ?? details?.status ?? null;
  const language =
    languageName(details?.original_language) ??
    languageName(tmdbField<string>(movie.tmdbData, "original_language"));
  const isAdult =
    details?.adult ?? tmdbField<boolean>(movie.tmdbData, "adult") ?? false;

  // Original-font title treatment (TMDB logo artwork), like the reference app.
  const logoPath = pickMovieLogo(images?.logos);
  const logoSrc = logoUrl(logoPath);

  // Parental guide: theatrical certification, US first then app region.
  const region = (process.env.WATCH_REGION || "NG").toUpperCase();
  const certification = pickCertification(releaseDates, region);

  const trailerKey = pickTrailerKey(videos);
  const trailerName =
    videos.find((v) => v.key === trailerKey)?.name ?? "Official Trailer";
  const trailerThumb = trailerKey
    ? `https://i.ytimg.com/vi/${trailerKey}/hqdefault.jpg`
    : null;
  const trailerPoster = trailerThumb ?? backdropUrl(movie.backdropPath, "w1280");
  const extraTrailers = videos
    .filter((v) => v.site === "YouTube" && v.key && v.key !== trailerKey)
    .slice(0, 5);

  const releaseLabel = formatReleaseDate(movie.releaseDate);
  const runtimeLabel = movie.runtime ? formatRuntime(movie.runtime) : null;
  const metaLine = [releaseLabel, runtimeLabel].filter(Boolean).join("  ·  ");

  const posterSrc = posterUrl(movie.posterPath, "w342");
  const backdropSrc = backdropUrl(movie.backdropPath, "w780");
  // Small file, stretched + blurred — tints the whole page like the reference.
  const ambientSrc =
    backdropUrl(movie.backdropPath, "w300") ??
    posterUrl(movie.posterPath, "w185");

  // Title-meta rating: Tomatometer first, TMDB star only when no RT score.
  const heroRt =
    reviews.rtScore != null && reviews.rtScore >= 0
      ? reviews.rtScore
      : movie.rtScore != null && movie.rtScore >= 0
        ? movie.rtScore
        : null;

  const isWatched = userMovie?.status === "watched";

  return (
    <div
      className="min-h-dvh bg-black pb-safe-page"
      style={
        {
          "--theme": theme.v,
          "--theme-deep": theme.deep,
          backgroundImage:
            "radial-gradient(110% 34rem at 50% -8rem, rgb(var(--theme) / 0.22), transparent 70%)",
        } as CSSProperties
      }
    >
      {/* ---------- Adaptive hero (reference style) ----------
          Sharp backdrop capped at ~50% viewport; poster + original-font logo
          overlap its fading bottom edge. Blurred ambience tints the page. */}
      <div className="relative overflow-hidden">
        {/* Whole-page photographic ambience (cheap w300 file, painted once) */}
        {ambientSrc ? (
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <Image
              src={ambientSrc}
              alt=""
              fill
              sizes="100vw"
              className="scale-105 object-cover object-top opacity-30 blur-2xl saturate-150"
              unoptimized
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black" />
          </div>
        ) : null}

        {/* Backdrop band — sharp, ~32% of the viewport (tightened from 48dvh
            so the poster sits much closer to the top — matches the
            scrolled “better” reference where gap was ~150px not ~300px). */}
        <div
          className="relative h-[32dvh] max-h-[320px] min-h-[220px] overflow-hidden"
          style={{
            maskImage: "linear-gradient(to bottom, black 55%, transparent 98%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, black 55%, transparent 98%)",
          }}
        >
          {backdropSrc ? (
            <Image
              src={backdropSrc}
              alt=""
              aria-hidden
              fill
              sizes="100vw"
              className="object-cover"
              unoptimized
              priority
            />
          ) : (
            <div
              aria-hidden
              className="h-full w-full"
              style={{
                background:
                  "linear-gradient(to bottom, rgb(var(--theme) / 0.55), #000)",
              }}
            />
          )}
          {/* legibility scrims + theme seam glow */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/60 to-transparent"
          />
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-[65%]"
            style={{
              background:
                "radial-gradient(90% 100% at 50% 100%, rgb(var(--theme) / 0.4), transparent 70%), linear-gradient(to top, #000 22%, rgb(0 0 0 / 0.65) 52%, transparent)",
            }}
          />

          {/* Top controls over the art */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
            <Link
              href="/movies"
              aria-label="Back to movies"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.12] text-white ring-1 ring-white/30 shadow-[0_8px_24px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-xl transition hover:bg-white/25 active:scale-95"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            {isWatched ? (
              <div className="flex items-center gap-2">
                <AddToListButton
                  mediaType="movie"
                  tmdbId={tmdbId}
                  title={movie.title}
                  posterPath={movie.posterPath}
                />
                <FavoriteButton
                  mediaType="movie"
                  tmdbId={tmdbId}
                  initialFavorite={userMovie?.favorite ?? false}
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <AddToListButton
                  mediaType="movie"
                  tmdbId={tmdbId}
                  title={movie.title}
                  posterPath={movie.posterPath}
                />
                <span className="h-10 w-10" aria-hidden />
              </div>
            )}
          </div>
        </div>

        <div className="relative px-4 pb-5">
          {/* Poster card overlapping the backdrop fade (~50% width) — overlap
              tuned to -mt-24 so shorter hero (≈272px) leaves ≈176px gap vs
              old ~300px; closely matches scrolled reference ~150px. */}
          <div className="mx-auto -mt-24 w-[50%] max-w-[220px]">
            <div className="relative aspect-[2/3] overflow-hidden rounded-[1.75rem] shadow-[0_24px_80px_-16px_rgb(var(--theme)/0.6),0_10px_30px_rgba(0,0,0,0.6)] ring-1 ring-white/25">
              {posterSrc ? (
                <Image
                  src={posterSrc}
                  alt={`${movie.title} poster`}
                  fill
                  sizes="(max-width: 480px) 50vw, 220px"
                  className="object-cover"
                  unoptimized
                  priority
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-card p-4 text-center text-sm font-bold text-white/50">
                  {movie.title}
                </div>
              )}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-white/10" />
            </div>
          </div>

          {/* Title — original-font logo artwork when available */}
          <h1 className="mt-4 flex justify-center px-6 text-center">
            {logoSrc ? (
              <Image
                src={logoSrc}
                alt={movie.title}
                width={512}
                height={288}
                sizes="(max-width: 480px) 80vw, 400px"
                className="h-20 w-auto max-w-[85%] object-contain drop-shadow-[0_6px_20px_rgba(0,0,0,0.9)]"
                unoptimized
              />
            ) : (
              <span className="text-3xl font-black tracking-tight text-white drop-shadow">
                {movie.title}
              </span>
            )}
          </h1>

          {tagline ? (
            <p className="mx-auto mt-2 max-w-sm text-center text-sm italic leading-snug text-white/55">
              {tagline}
            </p>
          ) : null}

          {/* Meta: date · runtime · cert · vote */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-center">
            {metaLine ? (
              <span className="text-sm text-white/60">{metaLine}</span>
            ) : null}
            {certification ? (
              <span
                title={`Rated ${certification.code} (${certification.country})`}
                className="rounded-md bg-white/[0.12] px-2 py-0.5 text-xs font-black tracking-wide text-white ring-1 ring-white/30 backdrop-blur-xl"
              >
                {certification.code}
              </span>
            ) : null}
            {heroRt != null ? (
              <span className="inline-flex items-center gap-1 text-sm font-bold text-white/85">
                <span className="text-xl leading-none" title="Rotten Tomatoes">
                  🍅
                </span>
                {heroRt}%
              </span>
            ) : movie.voteAverage ? (
              <span className="inline-flex items-center gap-1 text-sm font-bold text-white/80">
                <Star className="h-3.5 w-3.5 fill-primary text-primary" />
                {movie.voteAverage.toFixed(1)}
              </span>
            ) : null}
          </div>

          {/* Genres */}
          {genres.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {genres.map((g) => (
                <span
                  key={g}
                  className="rounded-full bg-[rgb(var(--theme)/0.18)] px-3 py-1 text-[11px] font-semibold text-white/80 shadow-[0_0_18px_rgb(var(--theme)/0.25)] ring-1 ring-white/20 backdrop-blur-xl"
                >
                  {g}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---------- Body ---------- */}
      <div className="relative px-4 pt-4">
        <MovieVixButton
          tmdbId={tmdbId}
          title={movie.title}
          isWatched={isWatched}
          isRewatchQueued={isRewatchQueued}
          playback={playback}
        />

        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1">
            <MovieWatchButton
              tmdbId={tmdbId}
              initialStatus={userMovie?.status || null}
            />
          </div>
          {isWatched && (
            <MovieRewatchButton
              tmdbId={tmdbId}
              initialCount={movieRewatchCount}
              initialQueued={isRewatchQueued}
            />
          )}
          {/* Offline download icon — null (zero space) while mode is off. */}
          <DownloadButton
            variant="icon"
            className="h-11 w-11"
            item={{ type: "movie", tmdbId, title: movie.title }}
          />
        </div>

        {isWatched && diaryDates.length > 0 && (
          <MovieDiaryLine dates={diaryDates} />
        )}

        {/* Reactions hidden for now — emoji row felt noisy next to scores.
        <div className="mt-3">
          <ReactionPicker
            size="md"
            item={{ type: "movie", tmdbId }}
            initialKeys={movieReactionKeys}
          />
        </div>
        */}

        {/* Critic + audience scores in frosted glass */}
        <div className="glass-panel mt-4 overflow-hidden rounded-3xl">
          <ScoreStrip
            className="mt-0 border-y-0"
            rtScore={reviews.rtScore}
            rtAudienceScore={reviews.rtAudienceScore}
            voteAverage={movie.voteAverage}
          />
        </div>

        {/* Your stars only after Mark Watched — not for unwatched titles */}
        {isWatched && (
          <div className="glass-panel mt-3 rounded-3xl p-4">
            <MovieRating
              tmdbId={tmdbId}
              initialRating={userMovie?.rating ?? null}
            />
          </div>
        )}

        {movie.overview && (
          <section className="mt-5">
            <h2 className="mb-2 text-lg font-extrabold tracking-tight text-white">
              Storyline
            </h2>
            <p className="text-sm leading-relaxed text-white/85">
              {movie.overview}
            </p>
          </section>
        )}

        {/* ---------- Trailers (reference placement) ---------- */}
        {trailerPoster && (
          <section className="mt-6">
            <div className="mb-2.5 flex items-baseline justify-between">
              <h2 className="text-lg font-extrabold tracking-tight text-white">
                Trailers
              </h2>
              {videos.length > 1 && (
                <span className="text-xs font-semibold text-white/40">
                  {videos.length} videos
                </span>
              )}
            </div>
            <a
              href={`https://www.youtube.com/watch?v=${trailerKey}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Watch ${movie.title} trailer on YouTube`}
              className="group relative block overflow-hidden rounded-[1.75rem] shadow-[0_20px_60px_-16px_rgb(var(--theme)/0.55)] ring-1 ring-white/15 transition active:scale-[0.99]"
            >
              <div className="relative aspect-video bg-secondary">
                <Image
                  src={trailerPoster}
                  alt={`${movie.title} trailer thumbnail`}
                  fill
                  sizes="(max-width: 480px) 100vw, 480px"
                  className="object-cover transition duration-300 group-hover:scale-[1.03]"
                  unoptimized
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.18] shadow-[0_12px_32px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.45),0_0_44px_rgb(var(--theme)/0.5)] ring-1 ring-white/50 backdrop-blur-2xl transition group-hover:scale-105">
                    <span
                      aria-hidden
                      className="absolute left-3 top-2 h-4 w-8 rounded-full bg-white/40 blur-[6px]"
                    />
                    <Play className="ml-1 h-6 w-6 fill-white text-white" />
                  </span>
                </div>
              </div>
            </a>
            <p className="mt-2 text-sm text-white/80">{trailerName}</p>

            {extraTrailers.length > 0 && (
              <div className="-mx-4 mt-3 flex gap-2.5 overflow-x-auto px-4 pb-1 scrollbar-none">
                {extraTrailers.map((v) => (
                  <a
                    key={v.id}
                    href={`https://www.youtube.com/watch?v=${v.key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group w-40 flex-shrink-0"
                  >
                    <div className="relative aspect-video overflow-hidden rounded-xl ring-1 ring-white/10">
                      <Image
                        src={`https://i.ytimg.com/vi/${v.key}/hqdefault.jpg`}
                        alt={v.name ?? "Trailer"}
                        fill
                        sizes="160px"
                        className="object-cover transition duration-300 group-hover:scale-[1.04]"
                        unoptimized
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.18] ring-1 ring-white/40 backdrop-blur-xl">
                          <Play className="ml-0.5 h-3.5 w-3.5 fill-white text-white" />
                        </span>
                      </div>
                    </div>
                    <p className="mt-1 truncate text-[11px] font-medium text-white/60">
                      {v.name ?? "Trailer"}
                    </p>
                  </a>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ---------- Facts: budget, revenue, parental guide, studios ---------- */}
        <section className="mt-6">
          <h2 className="mb-2.5 text-lg font-extrabold tracking-tight text-white">
            Details
          </h2>
          <div className="glass-panel rounded-3xl px-4 py-1.5">
            {directorLabel && (
              <div className="flex justify-between gap-3 border-b border-white/[0.06] py-2.5 text-sm last:border-0">
                <span className="shrink-0 text-white/45">
                  {directors.length > 1 ? "Directors" : "Director"}
                </span>
                <span className="text-right font-medium text-white">
                  {directorLabel}
                </span>
              </div>
            )}
            {status && (
              <div className="flex justify-between gap-3 border-b border-white/[0.06] py-2.5 text-sm last:border-0">
                <span className="shrink-0 text-white/45">Status</span>
                <span className="text-right font-medium text-white">
                  {status}
                </span>
              </div>
            )}
            {language && (
              <div className="flex justify-between gap-3 border-b border-white/[0.06] py-2.5 text-sm last:border-0">
                <span className="shrink-0 text-white/45">
                  Original language
                </span>
                <span className="text-right font-medium text-white">
                  {language}
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2.5 py-3">
              <div className="rounded-2xl bg-white/[0.05] px-3 py-2.5 ring-1 ring-white/[0.08]">
                <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">
                  <Wallet className="h-3 w-3" /> Budget
                </p>
                <p
                  title={budget > 0 ? formatMoneyFull(budget) : undefined}
                  className="mt-1 text-base font-black text-white"
                >
                  {formatMoneyShort(budget) ?? (
                    <span className="text-sm font-semibold text-white/35">
                      Not disclosed
                    </span>
                  )}
                </p>
              </div>
              <div className="rounded-2xl bg-white/[0.05] px-3 py-2.5 ring-1 ring-white/[0.08]">
                <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">
                  <TrendingUp className="h-3 w-3" /> Revenue
                </p>
                <p
                  title={revenue > 0 ? formatMoneyFull(revenue) : undefined}
                  className="mt-1 text-base font-black text-white"
                >
                  {formatMoneyShort(revenue) ?? (
                    <span className="text-sm font-semibold text-white/35">
                      Not disclosed
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] py-2.5 text-sm">
              <span className="flex shrink-0 items-center gap-1.5 text-white/45">
                <ShieldAlert className="h-3.5 w-3.5" /> Parental guide
              </span>
              {certification ? (
                <span className="flex items-center gap-1.5">
                  <span className="rounded-md bg-white/[0.12] px-2 py-0.5 text-xs font-black text-white ring-1 ring-white/30">
                    {certification.code}
                  </span>
                  <span className="text-xs text-white/40">
                    {certification.country}
                    {isAdult ? " · 18+" : ""}
                  </span>
                </span>
              ) : (
                <span className="text-sm font-medium text-white/35">
                  {isAdult ? "Adult · 18+" : "Not rated"}
                </span>
              )}
            </div>
            {studios.length > 0 && (
              <div className="border-t border-white/[0.06] py-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">
                  Studio{studios.length > 1 ? "s" : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                  {studios.slice(0, 6).map((s) => {
                    const companyLogo = logoUrl(s.logo_path, "w185");
                    return (
                      <span
                        key={s.id}
                        className="flex items-center gap-2 rounded-2xl bg-white/[0.06] py-1.5 pl-1.5 pr-3 ring-1 ring-white/10"
                      >
                        {companyLogo ? (
                          <span className="flex h-8 w-12 items-center justify-center overflow-hidden rounded-xl bg-white p-1">
                            <Image
                              src={companyLogo}
                              alt={`${s.name} logo`}
                              width={48}
                              height={32}
                              className="h-full w-full object-contain"
                              unoptimized
                            />
                          </span>
                        ) : (
                          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10">
                            <Building2 className="h-4 w-4 text-white/60" />
                          </span>
                        )}
                        <span className="max-w-[8rem] truncate text-xs font-semibold text-white/85">
                          {s.name}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Top-billed cast */}
        {cast.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2.5 text-lg font-extrabold tracking-tight text-white">
              Cast
            </h2>
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 scrollbar-none">
              {cast.map((person) => {
                const photo = posterUrl(person.profile_path, "w185");
                return (
                  <div key={person.id} className="w-28 flex-shrink-0">
                    <div className="relative h-36 overflow-hidden rounded-2xl bg-secondary ring-1 ring-white/10">
                      {photo ? (
                        <Image
                          src={photo}
                          alt={person.name}
                          fill
                          sizes="112px"
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xl font-black text-white/30">
                          {person.name.charAt(0)}
                        </div>
                      )}
                    </div>
                    <p className="mt-1.5 truncate text-xs font-semibold leading-tight text-white/90">
                      {person.name}
                    </p>
                    {person.character && (
                      <p className="truncate text-[11px] leading-tight text-white/40">
                        {person.character}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div className="mt-5">
          <WatchProviders providers={providers} />
        </div>

        <CommunityReviews payload={reviews} mediaTitle={movie.title} />

        <div className="mt-6">
          <DiscoverRail label="You Might Also Like" items={moreLikeThis} />
          <DiscoverRail label="Recommended for you" items={recommended} />
        </div>

        {trailerKey && (
          <a
            href={`https://www.youtube.com/watch?v=${trailerKey}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex items-center justify-center gap-1 text-xs font-semibold text-white/35 transition hover:text-white/70"
          >
            More trailers on YouTube
            <ChevronRight className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}
