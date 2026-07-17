import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userShows, watchedEpisodes } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tmdbId, following } = await request.json();

  if (following) {
    await db
      .insert(userShows)
      .values({
        userId: session.user.id,
        tmdbId,
        status: "watching",
      })
      .onConflictDoUpdate({
        target: [userShows.userId, userShows.tmdbId],
        set: {
          status: "watching",
          updatedAt: new Date(),
        },
      });
  } else {
    await db
      .delete(userShows)
      .where(
        and(
          eq(userShows.userId, session.user.id),
          eq(userShows.tmdbId, tmdbId)
        )
      );

    await db
      .delete(watchedEpisodes)
      .where(
        and(
          eq(watchedEpisodes.userId, session.user.id),
          eq(watchedEpisodes.showTmdbId, tmdbId)
        )
      );
  }

  return NextResponse.json({ success: true });
}
