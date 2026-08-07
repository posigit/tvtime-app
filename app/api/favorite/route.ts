import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userMovies, userShows } from "@/lib/schema";
import { ensureMovie, ensureShow } from "@/lib/ensure";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";

const VALID_TYPE = ["movie", "tv"] as const;
type MediaType = (typeof VALID_TYPE)[number];

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const mediaType = body.mediaType as MediaType;
  const tmdbId = Number(body.tmdbId);
  const favorite = Boolean(body.favorite);

  if (!VALID_TYPE.includes(mediaType)) {
    return NextResponse.json({ error: "Invalid mediaType" }, { status: 400 });
  }
  if (!Number.isFinite(tmdbId)) {
    return NextResponse.json({ error: "Invalid tmdbId" }, { status: 400 });
  }

  const userId = session.user.id;

  if (mediaType === "tv") {
    await ensureShow(tmdbId);
    await db
      .insert(userShows)
      .values({ userId, tmdbId, status: "watching", favorite })
      .onConflictDoUpdate({
        target: [userShows.userId, userShows.tmdbId],
        set: { favorite },
      });
  } else {
    await ensureMovie(tmdbId);
    await db
      .insert(userMovies)
      .values({ userId, tmdbId, status: "want_to_watch", favorite })
      .onConflictDoUpdate({
        target: [userMovies.userId, userMovies.tmdbId],
        set: { favorite },
      });
  }

  return NextResponse.json({ success: true, favorite });
}

/** Fetch the favorite flag for one movie or show for the current user. */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ favorite: false });

  const { searchParams } = new URL(request.url);
  const mediaType = searchParams.get("mediaType") as MediaType | null;
  const tmdbId = Number(searchParams.get("tmdbId"));

  if (!VALID_TYPE.includes(mediaType as MediaType) || !Number.isFinite(tmdbId)) {
    return NextResponse.json({ favorite: false });
  }

  const table = mediaType === "tv" ? userShows : userMovies;
  const [row] = await db
    .select({ favorite: table.favorite })
    .from(table)
    .where(
      and(
        eq(table.userId, session.user.id),
        eq(table.tmdbId, tmdbId)
      )
    )
    .limit(1);

  return NextResponse.json({ favorite: Boolean(row?.favorite) });
}