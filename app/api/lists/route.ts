import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userLists } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

/** List all of the current user's lists (newest first). */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const hasTmdbId = Number(searchParams.get("tmdbId"));
  const hasMediaType = searchParams.get("mediaType");
  const rows = await db
    .select()
    .from(userLists)
    .where(eq(userLists.userId, session.user.id))
    .orderBy(desc(userLists.updatedAt));
  return NextResponse.json({
    lists: rows.map((r) => {
      const items = Array.isArray(r.items) ? r.items : [];
      const contains =
        Number.isFinite(hasTmdbId) &&
        (hasMediaType === "show" || hasMediaType === "movie")
          ? (items as { tmdbId?: unknown; mediaType?: unknown }[]).some(
              (i) => i.tmdbId === hasTmdbId && i.mediaType === hasMediaType
            )
          : undefined;
      return {
        id: r.id,
        name: r.name,
        type: r.type,
        count: items.length,
        updatedAt: r.updatedAt,
        ...(contains === undefined ? {} : { contains }),
      };
    }),
  });
}

/** Create a custom list. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  const [row] = await db
    .insert(userLists)
    .values({
      id: randomUUID(),
      userId: session.user.id,
      name,
      type: "custom",
      items: [],
    })
    .returning({ id: userLists.id, name: userLists.name });
  return NextResponse.json({ list: row }, { status: 201 });
}
