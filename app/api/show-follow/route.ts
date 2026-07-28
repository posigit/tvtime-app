import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userShows, watchedEpisodes } from "@/lib/schema";
import { ensureShow, ensureEpisodes } from "@/lib/ensure";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const tmdbId = Number(body.tmdbId);
  const following = Boolean(body.following);

  if (!Number.isFinite(tmdbId)) {
    return NextResponse.json({ error: "Invalid tmdbId" }, { status: 400 });
  }

  try {
    if (following) {
      // Parent row must exist (FK) — Explore + can fire on never-opened titles
      const show = await ensureShow(tmdbId);
      // Kick episode catalog so Watch List can show a next episode soon
      void ensureEpisodes(tmdbId, show.numberOfSeasons ?? null).catch(() => {});

      const now = new Date();
      await db
        .insert(userShows)
        .values({
          userId: session.user.id,
          tmdbId,
          status: "watching",
          followedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [userShows.userId, userShows.tmdbId],
          set: {
            status: "watching",
            // Only stamp followedAt if they were not already following
            // (re-follow after remove is a new follow)
            followedAt: now,
            updatedAt: now,
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
  } catch (err) {
    console.error("show-follow failed:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to update follow",
      },
      { status: 500 }
    );
  }
}
