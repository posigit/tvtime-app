import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { playbackPositions } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

/**
 * Resume-playback positions.
 *   GET    /api/playback?type=movie|tv&id=<tmdbId>[&season=N&episode=N]
 *   POST   { type, tmdbId, season?, episode?, positionSeconds, durationSeconds }
 *   DELETE /api/playback?type=...&id=...
 * Movies use season/episode = 0 (defaults).
 */

function parseMediaParams(sp: URLSearchParams) {
  const type = sp.get("type"); // "movie" | "tv"
  const tmdbId = Number(sp.get("id"));
  const seasonNumber = Number(sp.get("season") ?? 0);
  const episodeNumber = Number(sp.get("episode") ?? 0);
  if ((type !== "movie" && type !== "tv") || !Number.isFinite(tmdbId)) {
    return null;
  }
  return { type, tmdbId, seasonNumber, episodeNumber };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const p = parseMediaParams(req.nextUrl.searchParams);
  if (!p) return NextResponse.json({ error: "Invalid params" }, { status: 400 });

  const [row] = await db
    .select({
      positionSeconds: playbackPositions.positionSeconds,
      durationSeconds: playbackPositions.durationSeconds,
    })
    .from(playbackPositions)
    .where(
      and(
        eq(playbackPositions.userId, session.user.id),
        eq(playbackPositions.mediaType, p.type),
        eq(playbackPositions.tmdbId, p.tmdbId),
        eq(playbackPositions.seasonNumber, p.seasonNumber),
        eq(playbackPositions.episodeNumber, p.episodeNumber)
      )
    )
    .limit(1);

  if (!row) return NextResponse.json({ positionSeconds: 0 });
  return NextResponse.json(row);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Media identity comes from the query (same as GET/DELETE); the body only
  // carries position/duration.
  const p = parseMediaParams(req.nextUrl.searchParams);
  if (!p) return NextResponse.json({ error: "Invalid params" }, { status: 400 });

  const body = await req.json();
  const positionSeconds = Number(body.positionSeconds);
  const durationSeconds = Number(body.durationSeconds ?? 0);

  if (!Number.isFinite(positionSeconds)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  await db
    .insert(playbackPositions)
    .values({
      userId: session.user.id,
      mediaType: p.type,
      tmdbId: p.tmdbId,
      seasonNumber: p.seasonNumber,
      episodeNumber: p.episodeNumber,
      positionSeconds: Math.max(0, Math.round(positionSeconds)),
      durationSeconds: Math.max(0, Math.round(durationSeconds)),
    })
    .onConflictDoUpdate({
      target: [
        playbackPositions.userId,
        playbackPositions.mediaType,
        playbackPositions.tmdbId,
        playbackPositions.seasonNumber,
        playbackPositions.episodeNumber,
      ],
      set: {
        positionSeconds: Math.max(0, Math.round(positionSeconds)),
        durationSeconds: Math.max(0, Math.round(durationSeconds)),
        updatedAt: sql`now()`,
      },
    });

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const p = parseMediaParams(req.nextUrl.searchParams);
  if (!p) return NextResponse.json({ error: "Invalid params" }, { status: 400 });

  await db
    .delete(playbackPositions)
    .where(
      and(
        eq(playbackPositions.userId, session.user.id),
        eq(playbackPositions.mediaType, p.type),
        eq(playbackPositions.tmdbId, p.tmdbId),
        eq(playbackPositions.seasonNumber, p.seasonNumber),
        eq(playbackPositions.episodeNumber, p.episodeNumber)
      )
    );

  return NextResponse.json({ success: true });
}
