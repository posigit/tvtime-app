import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { watchedEpisodes, userShows } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

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

  for (const { showTmdbId: sid, seasonNumber, episodeNumber, watched } of items) {
    if (sid !== showTmdbId) {
      return NextResponse.json(
        { error: "All batch items must belong to the same show" },
        { status: 400 }
      );
    }

    if (watched) {
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
  const lastWatched = watchedRows.sort(
    (a, b) =>
      a.seasonNumber * 1000 + a.episodeNumber -
      (b.seasonNumber * 1000 + b.episodeNumber)
  ).at(-1);

  await db
    .update(userShows)
    .set({
      lastSeason: lastWatched?.seasonNumber ?? null,
      lastEpisode: lastWatched?.episodeNumber ?? null,
      lastWatchedAt: count > 0 ? new Date() : null,
      episodesWatched: count,
      updatedAt: new Date(),
    })
    .where(and(eq(userShows.userId, session.user.id), eq(userShows.tmdbId, showTmdbId)));

  return NextResponse.json({ success: true });
}
