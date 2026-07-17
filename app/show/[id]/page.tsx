import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  userShows,
  watchedEpisodes,
} from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { backdropUrl, posterUrl } from "@/lib/tmdb";
import { ensureShow, ensureEpisodes } from "@/lib/ensure";
import { EpisodeData } from "@/components/episode-row";
import { SeasonEpisodeList } from "@/components/season-episode-list";
import { ShowFollowButton } from "@/components/show-follow-button";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft } from "lucide-react";

export default async function ShowDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { id } = await params;
  const { season: seasonParam } = await searchParams;
  const tmdbId = Number(id);
  if (!Number.isFinite(tmdbId)) notFound();

  const userId = await requireAuth();

  const show = await ensureShow(tmdbId);
  if (!show) notFound();

  const userShow = await db.query.userShows.findFirst({
    where: and(eq(userShows.userId, userId), eq(userShows.tmdbId, tmdbId)),
  });

  const selectedSeason = seasonParam ? Number(seasonParam) : userShow?.lastSeason || 1;

  const [allEpisodes, watched] = await Promise.all([
    ensureEpisodes(tmdbId, show.numberOfSeasons),
    db
      .select({
        seasonNumber: watchedEpisodes.seasonNumber,
        episodeNumber: watchedEpisodes.episodeNumber,
      })
      .from(watchedEpisodes)
      .where(
        and(
          eq(watchedEpisodes.userId, userId),
          eq(watchedEpisodes.showTmdbId, tmdbId)
        )
      ),
  ]);

  const watchedSet = new Set(
    watched.map((w) => `${w.seasonNumber}:${w.episodeNumber}`)
  );

  const allEpisodeData: EpisodeData[] = allEpisodes
    .slice()
    .sort((a, b) =>
      a.seasonNumber !== b.seasonNumber
        ? a.seasonNumber - b.seasonNumber
        : a.episodeNumber - b.episodeNumber
    )
    .map((ep) => ({
      episodeNumber: ep.episodeNumber,
      seasonNumber: ep.seasonNumber,
      name: ep.title,
      overview: ep.overview ?? undefined,
      airDate: ep.airDate ?? undefined,
      stillPath: ep.stillPath ?? null,
      runtime: ep.runtime ?? undefined,
      watched: watchedSet.has(`${ep.seasonNumber}:${ep.episodeNumber}`),
    }));

  const episodeData = allEpisodeData.filter(
    (ep) => ep.seasonNumber === selectedSeason
  );

  const totalSeasons = show.numberOfSeasons || 1;
  const seasons = Array.from({ length: totalSeasons }, (_, i) => i + 1);

  return (
    <div className="min-h-screen bg-black pb-20">
      <div className="relative h-48 w-full overflow-hidden">
        {show.backdropPath ? (
          <Image
            src={backdropUrl(show.backdropPath, "w1280") ?? ""}
            alt={show.title}
            fill
            sizes="100vw"
            className="object-cover"
            unoptimized
            priority
          />
        ) : (
          <div className="h-full w-full bg-card" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
        <Link
          href="/shows"
          className="absolute left-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
      </div>

      <div className="-mt-12 px-4">
        <div className="flex gap-4">
          <div className="relative h-36 w-24 flex-shrink-0 overflow-hidden rounded-lg bg-secondary shadow-lg">
            {show.posterPath ? (
              <Image
                src={posterUrl(show.posterPath, "w342") ?? ""}
                alt={show.title}
                width={96}
                height={144}
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                No img
              </div>
            )}
          </div>

          <div className="flex-1 pt-12">
            <h1 className="text-xl font-bold text-white">{show.title}</h1>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {show.firstAirDate && (
                <span>{show.firstAirDate.slice(0, 4)}</span>
              )}
              {show.status && (
                <>
                  <span>·</span>
                  <span>{show.status}</span>
                </>
              )}
              {show.voteAverage && (
                <>
                  <span>·</span>
                  <span className="text-primary">★ {show.voteAverage.toFixed(1)}</span>
                </>
              )}
            </div>
            {show.numberOfSeasons && (
              <p className="mt-1 text-xs text-muted-foreground">
                {show.numberOfSeasons} seasons · {show.numberOfEpisodes} episodes
              </p>
            )}
          </div>
        </div>

        {show.overview && (
          <p className="mt-4 text-sm text-muted-foreground line-clamp-3">{show.overview}</p>
        )}

        <div className="mt-4">
          <ShowFollowButton
            tmdbId={tmdbId}
            initialFollowing={!!userShow}
          />
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
          {seasons.map((s) => (
            <Link
              key={s}
              href={`/show/${tmdbId}?season=${s}`}
              className={`flex-shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                s === selectedSeason
                  ? "bg-primary text-black"
                  : "bg-card text-muted-foreground hover:text-white"
              }`}
            >
              Season {s}
            </Link>
          ))}
        </div>

        <SeasonEpisodeList
          episodes={episodeData}
          allEpisodes={allEpisodeData}
          showTmdbId={tmdbId}
        />
      </div>
    </div>
  );
}
