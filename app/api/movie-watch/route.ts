import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userMovies } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tmdbId, status } = await request.json();

  if (!Number.isFinite(tmdbId)) {
    return NextResponse.json({ error: "Invalid tmdbId" }, { status: 400 });
  }

  // status === null → remove from library entirely
  if (status === null) {
    await db
      .delete(userMovies)
      .where(
        and(
          eq(userMovies.userId, session.user.id),
          eq(userMovies.tmdbId, tmdbId)
        )
      );
    return NextResponse.json({ success: true });
  }

  if (status !== "watched" && status !== "want_to_watch") {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  await db
    .insert(userMovies)
    .values({
      userId: session.user.id,
      tmdbId,
      status,
      watchedAt: status === "watched" ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: [userMovies.userId, userMovies.tmdbId],
      set: {
        status,
        watchedAt: status === "watched" ? new Date() : null,
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ success: true });
}
