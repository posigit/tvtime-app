import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userLists } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { posterUrl } from "@/lib/tmdb";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft } from "lucide-react";
import { StickyChrome } from "@/components/sticky-chrome";
import {
  CustomListHeader,
  RemoveListItemButton,
} from "@/components/custom-list-actions";

type StoredItem = {
  tmdbId?: number;
  mediaType?: string;
  title?: string;
  posterPath?: string | null;
};

export default async function CustomListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = await requireAuth();
  const rows = await db
    .select()
    .from(userLists)
    .where(and(eq(userLists.id, id), eq(userLists.userId, userId)))
    .limit(1);
  const list = rows[0];
  if (!list || list.type !== "custom") notFound();

  const items = (Array.isArray(list.items) ? list.items : []).filter(
    (i): i is StoredItem & { tmdbId: number } =>
      !!i && Number.isFinite((i as StoredItem).tmdbId)
  );

  return (
    <div className="min-h-dvh bg-black pb-safe-page text-white">
      <StickyChrome>
        <div className="flex items-center gap-2 px-4 pb-1 pt-1">
          <Link
            href="/profile"
            aria-label="Back to profile"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white ring-1 ring-white/10 transition hover:bg-white/10"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-lg font-black text-white">
            {list.name}
          </h1>
          <CustomListHeader id={list.id} name={list.name} />
        </div>
      </StickyChrome>
      <div className="px-4 pt-4">
        <p className="mb-3 text-xs text-white/45">
          {items.length} {items.length === 1 ? "title" : "titles"}
        </p>
        {items.length === 0 ? (
          <div className="flex min-h-[30dvh] flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm font-semibold text-white/60">
              Nothing here yet
            </p>
            <Link
              href="/explore"
              className="rounded-full bg-primary px-6 py-3 text-sm font-bold uppercase tracking-wide text-black"
            >
              Browse all
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-x-2 gap-y-4">
            {items.map((item) => {
              const isMovie = item.mediaType === "movie";
              const href = isMovie
                ? `/movie/${item.tmdbId}`
                : `/show/${item.tmdbId}`;
              const src = item.posterPath
                ? (posterUrl(item.posterPath, "w342") ?? null)
                : null;
              return (
                <div key={`${item.mediaType}-${item.tmdbId}`} className="relative">
                  <Link
                    href={href}
                    className="block overflow-visible rounded-md bg-card"
                  >
                    <div
                      style={{ aspectRatio: "2 / 3" }}
                      className="relative bg-secondary"
                    >
                      <div className="absolute inset-0 overflow-hidden rounded-md">
                        {src ? (
                          <Image
                            src={src}
                            alt={item.title || ""}
                            fill
                            sizes="(max-width: 768px) 33vw, 200px"
                            className="object-cover"
                            unoptimized
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-[#3a7bd5] p-2 text-center">
                            <span className="text-xs font-medium text-white">
                              {item.title || "No title yet"}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                  <RemoveListItemButton
                    listId={list.id}
                    tmdbId={item.tmdbId}
                    mediaType={isMovie ? "movie" : "show"}
                    title={item.title || "this title"}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
