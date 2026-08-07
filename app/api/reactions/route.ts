import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { episodeReactions, movieReactions } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * Reactions (👍 like, ❤️ love, 😂 lol, 😮 wow, 😢 sad, 😡 mad).
 *
 * GET  ?type=episode&showTmdbId=&seasonNumber=&episodeNumber=
 *      ?type=movie&tmdbId=
 *      → { keys: string[] }  (the user's active reactions for that item)
 *
 * POST { type: "episode"|"movie", ...item, reactionKey }
 *      → toggles the reaction: adds it, or removes it if already active.
 *      Returns { active: boolean }.
 *
 * One reaction per key per item (composite PK). Multiple keys per item allowed.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sp = new URL(request.url).searchParams;
  const type = sp.get("type");
  const userId = session.user.id;

  if (type === "episode") {
    const showTmdbId = Number(sp.get("showTmdbId"));
    const seasonNumber = Number(sp.get("seasonNumber"));
    const episodeNumber = Number(sp.get("episodeNumber"));
    if (!Number.isFinite(showTmdbId) || !Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 });
    }
    const rows = await db
      .select({ reactionKey: episodeReactions.reactionKey })
      .from(episodeReactions)
      .where(
        and(
          eq(episodeReactions.userId, userId),
          eq(episodeReactions.showTmdbId, showTmdbId),
          eq(episodeReactions.seasonNumber, seasonNumber),
          eq(episodeReactions.episodeNumber, episodeNumber)
        )
      );
    return NextResponse.json({ keys: rows.map((r) => r.reactionKey) });
  }

  if (type === "movie") {
    const tmdbId = Number(sp.get("tmdbId"));
    if (!Number.isFinite(tmdbId)) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 });
    }
    const rows = await db
      .select({ reactionKey: movieReactions.reactionKey })
      .from(movieReactions)
      .where(
        and(eq(movieReactions.userId, userId), eq(movieReactions.tmdbId, tmdbId))
      );
    return NextResponse.json({ keys: rows.map((r) => r.reactionKey) });
  }

  return NextResponse.json({ error: "Invalid type" }, { status: 400 });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    type?: string;
    showTmdbId?: unknown;
    tmdbId?: unknown;
    seasonNumber?: unknown;
    episodeNumber?: unknown;
    reactionKey?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = session.user.id;
  const key = String(body.reactionKey ?? "").trim();
  if (!key) {
    return NextResponse.json({ error: "Invalid reactionKey" }, { status: 400 });
  }

  if (body.type === "episode") {
    const showTmdbId = Number(body.showTmdbId);
    const seasonNumber = Number(body.seasonNumber);
    const episodeNumber = Number(body.episodeNumber);
    if (
      !Number.isFinite(showTmdbId) ||
      !Number.isFinite(seasonNumber) ||
      !Number.isFinite(episodeNumber)
    ) {
      return NextResponse.json({ error: "Invalid episode" }, { status: 400 });
    }

    const where = and(
      eq(episodeReactions.userId, userId),
      eq(episodeReactions.showTmdbId, showTmdbId),
      eq(episodeReactions.seasonNumber, seasonNumber),
      eq(episodeReactions.episodeNumber, episodeNumber),
      eq(episodeReactions.reactionKey, key)
    );
    const existing = await db.select({ reactionKey: episodeReactions.reactionKey }).from(episodeReactions).where(where);
    if (existing.length > 0) {
      await db.delete(episodeReactions).where(where);
      return NextResponse.json({ active: false });
    }
    await db.insert(episodeReactions).values({
      userId,
      showTmdbId,
      seasonNumber,
      episodeNumber,
      reactionKey: key,
    });
    return NextResponse.json({ active: true });
  }

  if (body.type === "movie") {
    const tmdbId = Number(body.tmdbId);
    if (!Number.isFinite(tmdbId)) {
      return NextResponse.json({ error: "Invalid movie" }, { status: 400 });
    }
    const where = and(
      eq(movieReactions.userId, userId),
      eq(movieReactions.tmdbId, tmdbId),
      eq(movieReactions.reactionKey, key)
    );
    const existing = await db.select({ reactionKey: movieReactions.reactionKey }).from(movieReactions).where(where);
    if (existing.length > 0) {
      await db.delete(movieReactions).where(where);
      return NextResponse.json({ active: false });
    }
    await db.insert(movieReactions).values({ userId, tmdbId, reactionKey: key });
    return NextResponse.json({ active: true });
  }

  return NextResponse.json({ error: "Invalid type" }, { status: 400 });
}