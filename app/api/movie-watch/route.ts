import { auth } from "@/lib/auth";
import { db, withDbRetry } from "@/lib/db";
import { userMovies, watchHistory, playbackPositions } from "@/lib/schema";
import { ensureMovie } from "@/lib/ensure";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";

function isMissingColumn(err: unknown): boolean {
  const msg = String(
    (err as { message?: unknown })?.message ?? err ?? ""
  ).toLowerCase();
  return msg.includes("rewatch_queued") || msg.includes("42703");
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const tmdbId = Number(body.tmdbId);
  const status = body.status as string | null;

  if (!Number.isFinite(tmdbId)) {
    return NextResponse.json({ error: "Invalid tmdbId" }, { status: 400 });
  }

  try {
    // status === null → remove from library entirely
    if (status === null) {
      await withDbRetry(() =>
        db
          .delete(userMovies)
          .where(
            and(
              eq(userMovies.userId, session.user.id),
              eq(userMovies.tmdbId, tmdbId)
            )
          )
      );
      return NextResponse.json({ success: true });
    }

    if (
      status !== "watched" &&
      status !== "want_to_watch" &&
      status !== "for_later"
    ) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    // Parent row must exist (FK) before user_movies insert
    await ensureMovie(tmdbId);

    // Re-adding a WATCHED movie to the list = queue a rewatch (Letterboxd
    // style): keep status=watched + rating/history, set rewatchQueued=true so
    // it resurfaces in Watch Next. This is the "re-add for rewatch" answer.
    if (status === "want_to_watch" || status === "for_later") {
      const existing = await withDbRetry(() =>
        db.query.userMovies.findFirst({
          where: and(
            eq(userMovies.userId, session.user.id),
            eq(userMovies.tmdbId, tmdbId)
          ),
        })
      ).catch(() => null);
      if (existing?.status === "watched") {
        try {
          await withDbRetry(() =>
            db
              .update(userMovies)
              .set({ rewatchQueued: true, updatedAt: new Date() })
              .where(
                and(
                  eq(userMovies.userId, session.user.id),
                  eq(userMovies.tmdbId, tmdbId)
                )
              )
          );
        } catch (err) {
          // Migration not applied yet — fall through and keep watched state.
          if (!isMissingColumn(err)) throw err;
        }
        return NextResponse.json({
          success: true,
          queuedRewatch: true,
          status: "watched",
        });
      }
    }

    const now = new Date();
    const targetStatus = status === "for_later" ? "want_to_watch" : status;
    try {
      await withDbRetry(() =>
        db
          .insert(userMovies)
          .values({
            userId: session.user.id,
            tmdbId,
            status: targetStatus,
            watchedAt: targetStatus === "watched" ? now : null,
            updatedAt: now,
            ...(targetStatus === "watched" ? { rewatchQueued: false } : {}),
          })
          .onConflictDoUpdate({
            target: [userMovies.userId, userMovies.tmdbId],
            set: {
              status: targetStatus,
              watchedAt: targetStatus === "watched" ? now : null,
              updatedAt: now,
              ...(targetStatus === "watched" ? { rewatchQueued: false } : {}),
            },
          })
      );
    } catch (err) {
      if (!isMissingColumn(err)) throw err;
      // Retry without the new column on pre-migration databases.
      await withDbRetry(() =>
        db
          .insert(userMovies)
          .values({
            userId: session.user.id,
            tmdbId,
            status: targetStatus,
            watchedAt: targetStatus === "watched" ? now : null,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [userMovies.userId, userMovies.tmdbId],
            set: {
              status: targetStatus,
              watchedAt: targetStatus === "watched" ? now : null,
              updatedAt: now,
            },
          })
      );
    }

    if (targetStatus === "watched") {
      // Watch history entry + finished → drop any stale resume bookmark
      await withDbRetry(() =>
        db.insert(watchHistory).values({
          userId: session.user.id,
          mediaType: "movie",
          tmdbId,
          watchedAt: now,
          source: "manual",
        })
      );
      await withDbRetry(() =>
        db
          .delete(playbackPositions)
          .where(
            and(
              eq(playbackPositions.userId, session.user.id),
              eq(playbackPositions.mediaType, "movie"),
              eq(playbackPositions.tmdbId, tmdbId)
            )
          )
      );
    }

    return NextResponse.json({ success: true, status: targetStatus });
  } catch (err) {
    console.error("movie-watch failed:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to update movie",
      },
      { status: 500 }
    );
  }
}
