import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { cachedGenreList } from "@/lib/tmdb-list-cache";
import { filterNewMedia } from "@/lib/recommend";
import { getLibraryState } from "@/lib/explore-digest";
import { MOVIE_GENRES, TV_GENRES } from "@/lib/tmdb";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind");
  const id = Number(searchParams.get("id"));
  if ((kind !== "tv" && kind !== "movie") || !Number.isFinite(id)) {
    return NextResponse.json({ error: "Bad request", items: [] }, { status: 400 });
  }

  const allowed =
    kind === "tv"
      ? TV_GENRES.some((g) => g.id === id)
      : MOVIE_GENRES.some((g) => g.id === id);
  if (!allowed) {
    return NextResponse.json({ error: "Unknown genre", items: [] }, { status: 400 });
  }

  const [items, library] = await Promise.all([
    cachedGenreList(kind, id).catch(() => []),
    getLibraryState(session.user.id),
  ]);
  const owned = kind === "tv" ? library.followedShowIds : library.ownedMovieIds;

  return NextResponse.json({
    items: filterNewMedia(items, owned, 18),
  });
}
