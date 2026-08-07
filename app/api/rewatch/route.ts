import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { seasonRewatches, playbackPositions } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * POST { showTmdbId, seasonNumber }  — rewatch one season
 * POST { showTmdbId, season: "all" } — rewatch the whole series
 *
 * Rewatch is NON-DESTRUCTIVE: it clears only the resume bookmarks for the
 * target (so playback restarts from the top) and bumps the ×N badge counter.
 * It deliberately does NOT delete `watchedEpisodes` — that preserves per-episode
 * ratings and keeps `watchHistory`'s old completion dates intact (re-watching
 * appends a NEW history row, so both old and new watch dates remain logged).
 *
 * Whole-series counts live in a sentinel row `seasonNumber = 0` in the same
 * seasonRewatches table (no migration; kept out of the season badges to avoid
 * colliding with a "Specials" S0 label).
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const showTmdbId = Number(body.showTmdbId);
  const seasonAll = body.season === "all";
  const seasonNumber = seasonAll ? 0 : Number(body.seasonNumber);

  if (
    body.showTmdbId == null ||
    !Number.isFinite(showTmdbId) ||
    (!seasonAll && (body.seasonNumber == null || !Number.isFinite(seasonNumber)))
  ) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const userId = session.user.id;

  // Bump rewatch count (upsert). seasonNumber = 0 → whole-series counter.
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

  // Clear resume bookmarks so playback restarts from the top. For "all",
  // clear every episode's bookmark (no season filter).
  if (seasonAll) {
    await db
      .delete(playbackPositions)
      .where(
        and(
          eq(playbackPositions.userId, userId),
          eq(playbackPositions.mediaType, "tv"),
          eq(playbackPositions.tmdbId, showTmdbId)
        )
      );
  } else {
    await db
      .delete(playbackPositions)
      .where(
        and(
          eq(playbackPositions.userId, userId),
          eq(playbackPositions.mediaType, "tv"),
          eq(playbackPositions.tmdbId, showTmdbId),
          eq(playbackPositions.seasonNumber, seasonNumber)
        )
      );
  }

  return NextResponse.json({
    success: true,
    count: row?.count ?? 1,
    season: seasonAll ? "all" : seasonNumber,
  });
}