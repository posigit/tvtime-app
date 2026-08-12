import { auth } from "@/lib/auth";
import { db, withDbRetry } from "@/lib/db";
import {
  watchedEpisodes,
  userShows,
  episodes,
  watchHistory,
  playbackPositions,
} from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isEpisodeAired } from "@/lib/show-progress";

type WatchItem = {
  showTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  watched: boolean;
};

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const items: WatchItem[] = body.episodes || [body];

  if (items.length === 0) {
    return NextResponse.json({ success: true });
  }

  const showTmdbId = items[0].showTmdbId;

  for (const item of items) {
    if (item.showTmdbId !== showTmdbId) {
      return NextResponse.json(
        { error: "All batch items must belong to the same show" },
        { status: 400 }
      );
    }
  }

  // Load air dates for any mark-watched requests so we reject unaired eps
  const toMark = items.filter((i) => i.watched);
  const airDateByKey = new Map<string, string | null>();

  if (toMark.length > 0) {
    const showEps = await db
      .select({
        seasonNumber: episodes.seasonNumber,
        episodeNumber: episodes.episodeNumber,
        airDate: episodes.airDate,
      })
      .from(episodes)
      .where(eq(episodes.showTmdbId, showTmdbId));

    for (const ep of showEps) {
      airDateByKey.set(
        `${ep.seasonNumber}:${ep.episodeNumber}`,
        ep.airDate
      );
    }
  }

  const skippedUnaired: string[] = [];

  for (const { showTmdbId: sid, seasonNumber, episodeNumber, watched } of items) {
    if (watched) {
      const key = `${seasonNumber}:${episodeNumber}`;
      const airDate = airDateByKey.get(key);
      // If we have catalog data and it hasn't aired, skip (don't mark)
      if (airDateByKey.has(key) && !isEpisodeAired(airDate)) {
        skippedUnaired.push(`S${seasonNumber}E${episodeNumber}`);
        continue;
      }

      await db
        .insert(watchedEpisodes)
        .values({
          userId: session.user.id,
          showTmdbId: sid,
          seasonNumber,
          episodeNumber,
          watchedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            watchedEpisodes.userId,
            watchedEpisodes.showTmdbId,
            watchedEpisodes.seasonNumber,
            watchedEpisodes.episodeNumber,
          ],
          set: { watchedAt: new Date() },
        });

      // Watch history entry (append-only — rewatches show up again)
      await withDbRetry(() =>
        db.insert(watchHistory).values({
          userId: session.user.id,
          mediaType: "tv",
          tmdbId: sid,
          seasonNumber,
          episodeNumber,
          watchedAt: new Date(),
          source: "manual",
        })
      );

      // Episode finished — drop any stale resume bookmark
      await db
        .delete(playbackPositions)
        .where(
          and(
            eq(playbackPositions.userId, session.user.id),
            eq(playbackPositions.mediaType, "tv"),
            eq(playbackPositions.tmdbId, sid),
            eq(playbackPositions.seasonNumber, seasonNumber),
            eq(playbackPositions.episodeNumber, episodeNumber)
          )
        );
    } else {
      await db
        .delete(watchedEpisodes)
        .where(
          and(
            eq(watchedEpisodes.userId, session.user.id),
            eq(watchedEpisodes.showTmdbId, sid),
            eq(watchedEpisodes.seasonNumber, seasonNumber),
            eq(watchedEpisodes.episodeNumber, episodeNumber)
          )
        );

      // Unmarking removes the matching history entries + resume bookmark
      await db
        .delete(watchHistory)
        .where(
          and(
            eq(watchHistory.userId, session.user.id),
            eq(watchHistory.mediaType, "tv"),
            eq(watchHistory.tmdbId, sid),
            eq(watchHistory.seasonNumber, seasonNumber),
            eq(watchHistory.episodeNumber, episodeNumber)
          )
        );
      await db
        .delete(playbackPositions)
        .where(
          and(
            eq(playbackPositions.userId, session.user.id),
            eq(playbackPositions.mediaType, "tv"),
            eq(playbackPositions.tmdbId, sid),
            eq(playbackPositions.seasonNumber, seasonNumber),
            eq(playbackPositions.episodeNumber, episodeNumber)
          )
        );
    }
  }

  // Recalculate aggregate state once after the batch
  const watchedRows = await db
    .select({
      seasonNumber: watchedEpisodes.seasonNumber,
      episodeNumber: watchedEpisodes.episodeNumber,
    })
    .from(watchedEpisodes)
    .where(
      and(
        eq(watchedEpisodes.userId, session.user.id),
        eq(watchedEpisodes.showTmdbId, showTmdbId)
      )
    );

  const count = watchedRows.length;
  const lastWatched = watchedRows
    .sort(
      (a, b) =>
        a.seasonNumber * 1000 +
        a.episodeNumber -
        (b.seasonNumber * 1000 + b.episodeNumber)
    )
    .at(-1);

  await db
    .update(userShows)
    .set({
      lastSeason: lastWatched?.seasonNumber ?? null,
      lastEpisode: lastWatched?.episodeNumber ?? null,
      lastWatchedAt: count > 0 ? new Date() : null,
      episodesWatched: count,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userShows.userId, session.user.id),
        eq(userShows.tmdbId, showTmdbId)
      )
    );

  return NextResponse.json({
    success: true,
    skippedUnaired: skippedUnaired.length > 0 ? skippedUnaired : undefined,
  });
}
