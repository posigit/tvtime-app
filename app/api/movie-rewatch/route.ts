import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userMovies, watchHistory, playbackPositions } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * POST { tmdbId } — start a rewatch of an already-watched movie.
 *
 * Non-destructive: clears the resume bookmark (so replay starts at the top)
 * and appends a NEW watchHistory row with today's date. The existing history
 * row from the first watch stays, so both the original and the rewatch date
 * remain logged. The rewatch count is derived from watchHistory rows for this
 * movie (append-only for movies — never deleted), so no migration is needed.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const tmdbId = Number(body.tmdbId);
  if (body.tmdbId == null || !Number.isFinite(tmdbId) || tmdbId <= 0) {
    return NextResponse.json({ error: "Invalid tmdbId" }, { status: 400 });
  }

  const userId = session.user.id;

  // Clear resume bookmark so the rewatch starts from the top.
  await db
    .delete(playbackPositions)
    .where(
      and(
        eq(playbackPositions.userId, userId),
        eq(playbackPositions.mediaType, "movie"),
        eq(playbackPositions.tmdbId, tmdbId)
      )
    );

  // Append today's rewatch to the completion log (old date stays).
  await db.insert(watchHistory).values({
    userId,
    mediaType: "movie",
    tmdbId,
    watchedAt: new Date(),
    source: "manual",
  });

  // Touch watchedAt so the movie's "last watched" reflects the rewatch.
  await db
    .update(userMovies)
    .set({ watchedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(userMovies.userId, userId), eq(userMovies.tmdbId, tmdbId)));

  // Count total completions (first watch + rewatches) = rewatch count.
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(watchHistory)
    .where(
      and(
        eq(watchHistory.userId, userId),
        eq(watchHistory.mediaType, "movie"),
        eq(watchHistory.tmdbId, tmdbId)
      )
    );

  return NextResponse.json({ success: true, count: Number(row?.count ?? 1) });
}