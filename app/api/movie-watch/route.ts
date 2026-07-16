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
