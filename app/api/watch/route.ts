import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { watchedEpisodes, userShows } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { showTmdbId, seasonNumber, episodeNumber, watched } = await request.json();

  if (watched) {
    await db
      .insert(watchedEpisodes)
      .values({
        userId: session.user.id,
        showTmdbId,
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

    await db
      .update(userShows)
      .set({
        lastSeason: seasonNumber,
        lastEpisode: episodeNumber,
        lastWatchedAt: new Date(),
        episodesWatched: sql`${userShows.episodesWatched} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(userShows.userId, session.user.id), eq(userShows.tmdbId, showTmdbId)));
  } else {
    await db
      .delete(watchedEpisodes)
      .where(
        and(
          eq(watchedEpisodes.userId, session.user.id),
          eq(watchedEpisodes.showTmdbId, showTmdbId),
          eq(watchedEpisodes.seasonNumber, seasonNumber),
          eq(watchedEpisodes.episodeNumber, episodeNumber)
        )
      );

    await db
      .update(userShows)
      .set({
        episodesWatched: sql`GREATEST(${userShows.episodesWatched} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(and(eq(userShows.userId, session.user.id), eq(userShows.tmdbId, showTmdbId)));
  }

  return NextResponse.json({ success: true });
}
