import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userLists } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getOwnedList, type ListItemInput } from "@/lib/lists";

type StoredItem = {
  tmdbId: number;
  mediaType: "show" | "movie";
  title: string;
  posterPath: string | null;
  addedAt: number;
};

type Params = { params: Promise<{ id: string }> };

const MAX_ITEMS = 500;

function readItems(row: { items: unknown }): StoredItem[] {
  return Array.isArray(row.items) ? (row.items as StoredItem[]) : [];
}

function cleanItem(input: ListItemInput): StoredItem | null {
  const tmdbId = Number(input.tmdbId);
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;
  if (input.mediaType !== "show" && input.mediaType !== "movie") return null;
  return {
    tmdbId: Math.floor(tmdbId),
    mediaType: input.mediaType,
    title:
      typeof input.title === "string" && input.title.trim()
        ? input.title.trim().slice(0, 120)
        : `TMDB ${Math.floor(tmdbId)}`,
    posterPath:
      typeof input.posterPath === "string" && input.posterPath
        ? input.posterPath.slice(0, 200)
        : null,
    addedAt: Date.now(),
  };
}

/** Add an item (idempotent — re-adding refreshes it to the top). */
export async function POST(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const row = await getOwnedList(session.user.id, id);
  if (!row || row.type !== "custom") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as ListItemInput | null;
  const item = body ? cleanItem(body) : null;
  if (!item) {
    return NextResponse.json({ error: "Valid tmdbId + mediaType required" }, { status: 400 });
  }
  const rest = readItems(row).filter(
    (i) => !(i.tmdbId === item.tmdbId && i.mediaType === item.mediaType)
  );
  const items = [item, ...rest].slice(0, MAX_ITEMS);
  await db
    .update(userLists)
    .set({ items, updatedAt: new Date() })
    .where(eq(userLists.id, id));
  return NextResponse.json({ success: true, count: items.length });
}

/** Remove an item. */
export async function DELETE(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const row = await getOwnedList(session.user.id, id);
  if (!row || row.type !== "custom") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { searchParams } = new URL(request.url);
  const tmdbId = Number(searchParams.get("tmdbId"));
  const mediaType = searchParams.get("mediaType");
  if (!Number.isFinite(tmdbId)) {
    return NextResponse.json({ error: "tmdbId required" }, { status: 400 });
  }
  const items = readItems(row).filter(
    (i) =>
      !(
        i.tmdbId === Math.floor(tmdbId) &&
        (mediaType == null || i.mediaType === mediaType)
      )
  );
  await db
    .update(userLists)
    .set({ items, updatedAt: new Date() })
    .where(eq(userLists.id, id));
  return NextResponse.json({ success: true, count: items.length });
}
