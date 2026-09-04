import { NextRequest, NextResponse } from "next/server";

/**
 * Lightweight TMDB -> IMDb lookup for iframe-embed subtitle flows.
 * Native playback gets imdbId from the stream resolvers; embed sources
 * (e.g. CineSrc) never resolve, but OpenSubtitles needs an IMDb id —
 * so the player fetches it here instead of running a full resolution.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type"); // "movie" | "tv"
  const id = sp.get("id");
  if ((type !== "movie" && type !== "tv") || !id) {
    return NextResponse.json(
      { error: "type (movie|tv) and id are required" },
      { status: 400 }
    );
  }
  if (!process.env.TMDB_API_KEY) {
    return NextResponse.json({ imdbId: null });
  }
  try {
    const extPath =
      type === "tv" ? `/tv/${id}/external_ids` : `/movie/${id}/external_ids`;
    const res = await fetch(
      `https://api.themoviedb.org/3${extPath}?api_key=${process.env.TMDB_API_KEY}`,
      { cache: "no-store" }
    );
    if (!res.ok) return NextResponse.json({ imdbId: null });
    const data = (await res.json()) as { imdb_id?: string | null };
    return NextResponse.json({ imdbId: data.imdb_id ?? null });
  } catch {
    return NextResponse.json({ imdbId: null });
  }
}
