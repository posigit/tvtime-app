import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userMovies, watchedEpisodes } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * Set or clear a rating.
 * Ratings are integers 1-10 (displayed as 0.5-5 stars); null clears.
 * Movies: upserts library row (want_to_watch) if missing — can rate unwatched.
 * Episodes: must already be marked watched.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { kind, rating } = body as { kind?: string; rating?: number | null };

  if (
    rating !== null &&
    rating !== undefined &&
    (!Number.isInteger(rating) || rating < 1 || rating > 10)
  ) {
    return NextResponse.json(
      { error: "Rating must be an integer 1-10 or null" },
      { status: 400 }
    );
  }

  const value = rating ?? null;

  if (kind === "movie") {
    const tmdbId = Number(body.tmdbId);
    if (!Number.isFinite(tmdbId)) {
      return NextResponse.json({ error: "Invalid tmdbId" }, { status: 400 });
    }

    // Allow rating before "watched" — upsert into library as want_to_watch
    // if missing; never force status to watched just because they rated.
    const { ensureMovie } = await import("@/lib/ensure");
    await ensureMovie(tmdbId);

    const now = new Date();
    await db
      .insert(userMovies)
      .values({
        userId: session.user.id,
        tmdbId,
        status: "want_to_watch",
        rating: value,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [userMovies.userId, userMovies.tmdbId],
        set: {
          rating: value,
          updatedAt: now,
        },
      });

    return NextResponse.json({ success: true, added: true });
  }

  if (kind === "episode") {
    const showTmdbId = Number(body.showTmdbId);
    const seasonNumber = Number(body.seasonNumber);
    const episodeNumber = Number(body.episodeNumber);
    if (
      !Number.isFinite(showTmdbId) ||
      !Number.isFinite(seasonNumber) ||
      !Number.isFinite(episodeNumber)
    ) {
      return NextResponse.json(
        { error: "Invalid episode identifiers" },
        { status: 400 }
      );
    }

    const updated = await db
      .update(watchedEpisodes)
      .set({ rating: value })
      .where(
        and(
          eq(watchedEpisodes.userId, session.user.id),
          eq(watchedEpisodes.showTmdbId, showTmdbId),
          eq(watchedEpisodes.seasonNumber, seasonNumber),
          eq(watchedEpisodes.episodeNumber, episodeNumber)
        )
      )
      .returning({ showTmdbId: watchedEpisodes.showTmdbId });

    if (updated.length === 0) {
      return NextResponse.json(
        { error: "Episode is not marked as watched" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
}
