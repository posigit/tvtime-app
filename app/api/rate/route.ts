import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userMovies, watchedEpisodes } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * Set or clear a rating.
 * Ratings are integers 1-10 (displayed as 0.5-5 stars); null clears.
 * Movies: must already be marked watched.
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

    // Only allow rating after Mark Watched
    const row = await db.query.userMovies.findFirst({
      where: and(
        eq(userMovies.userId, session.user.id),
        eq(userMovies.tmdbId, tmdbId)
      ),
    });

    if (!row || row.status !== "watched") {
      return NextResponse.json(
        { error: "Mark the movie as watched before rating" },
        { status: 400 }
      );
    }

    await db
      .update(userMovies)
      .set({ rating: value, updatedAt: new Date() })
      .where(
        and(
          eq(userMovies.userId, session.user.id),
          eq(userMovies.tmdbId, tmdbId)
        )
      );

    return NextResponse.json({ success: true });
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
