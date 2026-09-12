import { db } from "@/lib/db";
import { userLists } from "@/lib/schema";
import { and, eq } from "drizzle-orm";

export type ListItemInput = {
  tmdbId: number;
  mediaType: "show" | "movie";
  title?: string;
  posterPath?: string | null;
};

/** Fetch one owned list row or null (404s without leaking ownership). */
export async function getOwnedList(userId: string, id: string) {
  const rows = await db
    .select()
    .from(userLists)
    .where(and(eq(userLists.id, id), eq(userLists.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}
