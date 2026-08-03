import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userShows, watchedEpisodes, seasonRewatches } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { ensureShow, ensureEpisodes } from "@/lib/ensure";
import {
  ShowDetailClient,
  DetailEpisode,
} from "@/components/show-detail-client";
import { filterNewMedia } from "@/lib/recommend";
import {
  getTvRecommendations,
  getTvSimilar,
  getWatchProviders,
} from "@/lib/tmdb";
import { getCommunityReviews } from "@/lib/reviews";
import { notFound } from "next/navigation";

export default async function ShowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tmdbId = Number(id);
  if (!Number.isFinite(tmdbId)) notFound();

  const userId = await requireAuth();

  const show = await ensureShow(tmdbId);
  if (!show) notFound();

  const [userShow, allEpisodes, watched, rewatches, ownedShows] =
    await Promise.all([
      db.query.userShows.findFirst({
        where: and(eq(userShows.userId, userId), eq(userShows.tmdbId, tmdbId)),
      }),
      ensureEpisodes(tmdbId, show.numberOfSeasons),
      db
        .select({
          seasonNumber: watchedEpisodes.seasonNumber,
          episodeNumber: watchedEpisodes.episodeNumber,
          rating: watchedEpisodes.rating,
        })
        .from(watchedEpisodes)
        .where(
          and(
            eq(watchedEpisodes.userId, userId),
            eq(watchedEpisodes.showTmdbId, tmdbId)
          )
        ),
      db
        .select({
          seasonNumber: seasonRewatches.seasonNumber,
          count: seasonRewatches.count,
        })
        .from(seasonRewatches)
        .where(
          and(
            eq(seasonRewatches.userId, userId),
            eq(seasonRewatches.showTmdbId, tmdbId)
          )
        ),
      db
        .select({ tmdbId: userShows.tmdbId })
        .from(userShows)
        .where(eq(userShows.userId, userId)),
    ]);

  const ownedIds = new Set(ownedShows.map((s) => s.tmdbId));

  const [similarRaw, recsRaw, providers, reviews] = await Promise.all([
    getTvSimilar(tmdbId).catch(() => []),
    getTvRecommendations(tmdbId).catch(() => []),
    getWatchProviders(tmdbId, "tv").catch(() => ({
      flatrate: [],
      rent: [],
      buy: [],
    })),
    getCommunityReviews({
      kind: "tv",
      tmdbId,
      title: show.title,
      year: show.firstAirDate,
    }).catch(() => []),
  ]);

  const moreLikeThis = filterNewMedia(similarRaw, ownedIds, 12);
  const recommended = filterNewMedia(recsRaw, ownedIds, 12);

  const watchedSet = new Set(
    watched.map((w) => `${w.seasonNumber}:${w.episodeNumber}`)
  );

  const episodeRatings: Record<string, number> = {};
  let ratingSum = 0;
  let ratingCount = 0;
  for (const w of watched) {
    if (w.rating != null) {
      episodeRatings[`${w.seasonNumber}:${w.episodeNumber}`] = w.rating;
      ratingSum += w.rating;
      ratingCount++;
    }
  }
  const derivedScore =
    ratingCount > 0
      ? { value: Math.round(ratingSum / ratingCount), count: ratingCount }
      : null;

  const episodes: DetailEpisode[] = allEpisodes
    .slice()
    .sort((a, b) =>
      a.seasonNumber !== b.seasonNumber
        ? a.seasonNumber - b.seasonNumber
        : a.episodeNumber - b.episodeNumber
    )
    .map((ep) => ({
      episodeNumber: ep.episodeNumber,
      seasonNumber: ep.seasonNumber,
      title: ep.title,
      overview: ep.overview ?? undefined,
      airDate: ep.airDate ?? undefined,
      stillPath: ep.stillPath ?? null,
      runtime: ep.runtime ?? undefined,
      watched: watchedSet.has(`${ep.seasonNumber}:${ep.episodeNumber}`),
    }));

  const rewatchCounts: Record<number, number> = {};
  for (const r of rewatches) {
    rewatchCounts[r.seasonNumber] = r.count;
  }

  return (
    <ShowDetailClient
      show={{
        tmdbId: show.tmdbId,
        title: show.title,
        posterPath: show.posterPath,
        backdropPath: show.backdropPath,
        overview: show.overview,
        status: show.status,
        networks: show.networks,
        numberOfSeasons: show.numberOfSeasons,
        numberOfEpisodes: show.numberOfEpisodes,
        episodeRuntime: show.episodeRuntime,
        voteAverage: show.voteAverage,
        rtScore: show.rtScore ?? null,
        firstAirDate: show.firstAirDate,
      }}
      episodes={episodes}
      rewatchCounts={rewatchCounts}
      initialFollowing={!!userShow}
      episodeRatings={episodeRatings}
      derivedScore={derivedScore}
      moreLikeThis={moreLikeThis}
      recommended={recommended}
      providers={providers}
      reviews={reviews}
    />
  );
}
