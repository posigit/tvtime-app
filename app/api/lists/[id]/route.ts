import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userLists } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getOwnedList } from "@/lib/lists";

type Params = { params: Promise<{ id: string }> };

/** Rename a custom list. Built-in lists (favorites) are read-only here. */
export async function PATCH(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const row = await getOwnedList(session.user.id, id);
  if (!row || row.type !== "custom") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  await db
    .update(userLists)
    .set({ name, updatedAt: new Date() })
    .where(eq(userLists.id, id));
  return NextResponse.json({ success: true, name });
}

/** Delete a custom list (items are snapshots — library rows untouched). */
export async function DELETE(_request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const row = await getOwnedList(session.user.id, id);
  if (!row || row.type !== "custom") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await db.delete(userLists).where(eq(userLists.id, id));
  return NextResponse.json({ success: true });
}
