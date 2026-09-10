import { auth } from "@/lib/auth";
import { db, withDbRetry } from "@/lib/db";
import { userMovies, watchHistory, playbackPositions } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

type RewatchMode = "queue" | "log" | "unqueue";

/**
 * POST { tmdbId, mode? } — Letterboxd-style movie rewatch.
 *
 * - `queue` (default for watched titles): keeps `status=watched` but sets
 *   `user_movies.rewatch_queued=true` so the movie resurfaces in Watch Next
 *   (screenshot-able plan) without losing rating/history. No history row.
 * - `log`: clears resume, appends a NEW watchHistory row (old dates stay),
 *   touches `watchedAt`, clears the queue flag. Count = total completions.
 * - `unqueue`: clears the queue flag only.
 *
 * Back-compat: no `mode` (old client) = `log`.
 */

function isMissingColumn(err: unknown): boolean {
  const msg = String(
    (err as { message?: unknown })?.message ?? err ?? ""
  ).toLowerCase();
  const cause = String(
    ((err as { cause?: { message?: unknown } })?.cause?.message ?? "")
  ).toLowerCase();
  return (
    msg.includes("rewatch_queued") ||
    cause.includes("rewatch_queued") ||
    msg.includes("42703") ||
    cause.includes("42703")
  );
}

async function setQueued(
  userId: string,
  tmdbId: number,
  queued: boolean
): Promise<boolean> {
  // Returns false when the column doesn't exist yet (migration not applied).
  try {
    await withDbRetry(() =>
      db
        .update(userMovies)
        .set({ rewatchQueued: queued, updatedAt: new Date() })
        .where(
          and(eq(userMovies.userId, userId), eq(userMovies.tmdbId, tmdbId))
        )
    );
    return true;
  } catch (err) {
    if (isMissingColumn(err)) return false;
    throw err;
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const tmdbId = Number(body.tmdbId);
  if (body.tmdbId == null || !Number.isFinite(tmdbId) || tmdbId <= 0) {
    return NextResponse.json({ error: "Invalid tmdbId" }, { status: 400 });
  }
  const rawMode = typeof body.mode === "string" ? body.mode : "log";
  const mode: RewatchMode =
    rawMode === "queue" || rawMode === "unqueue" ? rawMode : "log";

  const userId = session.user.id;

  const existing = await withDbRetry(() =>
    db.query.userMovies.findFirst({
      where: and(eq(userMovies.userId, userId), eq(userMovies.tmdbId, tmdbId)),
    })
  ).catch(() => null);

  if (!existing || existing.status !== "watched") {
    return NextResponse.json(
      { error: "Mark watched before queuing a rewatch" },
      { status: 409 }
    );
  }

  if (mode === "queue") {
    const applied = await setQueued(userId, tmdbId, true);
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(watchHistory)
      .where(
        and(
          eq(watchHistory.userId, userId),
          eq(watchHistory.mediaType, "movie"),
          eq(watchHistory.tmdbId, tmdbId)
        )
      )
      .catch(() => [{ count: 1 as unknown as number }]);
    return NextResponse.json({
      success: true,
      mode: "queue",
      queued: applied ? true : false,
      queuedFallback: applied ? undefined : "migration-pending",
      count: Number(row?.count ?? 1),
    });
  }

  if (mode === "unqueue") {
    await setQueued(userId, tmdbId, false);
    return NextResponse.json({ success: true, mode: "unqueue", queued: false });
  }

  // mode === "log": non-destructive completion stamp + dequeue.
  await withDbRetry(() =>
    db
      .delete(playbackPositions)
      .where(
        and(
          eq(playbackPositions.userId, userId),
          eq(playbackPositions.mediaType, "movie"),
          eq(playbackPositions.tmdbId, tmdbId)
        )
      )
  );

  await withDbRetry(() =>
    db.insert(watchHistory).values({
      userId,
      mediaType: "movie",
      tmdbId,
      watchedAt: new Date(),
      source: "manual",
    })
  );

  // Touch watchedAt so "last watched" reflects the rewatch; clear queue flag.
  try {
    await withDbRetry(() =>
      db
        .update(userMovies)
        .set({ watchedAt: new Date(), updatedAt: new Date(), rewatchQueued: false })
        .where(and(eq(userMovies.userId, userId), eq(userMovies.tmdbId, tmdbId)))
    );
  } catch (err) {
    if (!isMissingColumn(err)) throw err;
    await withDbRetry(() =>
      db
        .update(userMovies)
        .set({ watchedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(userMovies.userId, userId), eq(userMovies.tmdbId, tmdbId)))
    );
  }

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

  return NextResponse.json({
    success: true,
    mode: "log",
    queued: false,
    count: Number(row?.count ?? 1),
  });
}
