import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { seasonRewatches, userShows, watchedEpisodes } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * POST { showTmdbId, seasonNumber }
 * Starts a rewatch of a season: wipes the user's watched rows for that season
 * and bumps the rewatch counter (displayed as ×N on the season row).
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const showTmdbId = Number(body.showTmdbId);
  const seasonNumber = Number(body.seasonNumber);

  if (!Number.isFinite(showTmdbId) || !Number.isFinite(seasonNumber)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const userId = session.user.id;

  // Bump rewatch count (upsert)
  const [row] = await db
    .insert(seasonRewatches)
    .values({ userId, showTmdbId, seasonNumber, count: 1 })
    .onConflictDoUpdate({
      target: [
        seasonRewatches.userId,
        seasonRewatches.showTmdbId,
        seasonRewatches.seasonNumber,
      ],
      set: { count: sql`${seasonRewatches.count} + 1`, updatedAt: new Date() },
    })
    .returning({ count: seasonRewatches.count });

  // Reset watched progress for this season
  await db
    .delete(watchedEpisodes)
    .where(
      and(
        eq(watchedEpisodes.userId, userId),
        eq(watchedEpisodes.showTmdbId, showTmdbId),
        eq(watchedEpisodes.seasonNumber, seasonNumber)
      )
    );

  // Recompute aggregate show state
  const watchedRows = await db
    .select({
      seasonNumber: watchedEpisodes.seasonNumber,
      episodeNumber: watchedEpisodes.episodeNumber,
    })
    .from(watchedEpisodes)
    .where(
      and(
        eq(watchedEpisodes.userId, userId),
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
      and(eq(userShows.userId, userId), eq(userShows.tmdbId, showTmdbId))
    );

  return NextResponse.json({ success: true, count: row?.count ?? 1 });
}
