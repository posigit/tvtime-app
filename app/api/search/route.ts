import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * Server-side TMDB multi-search.
 * Client SearchBar must not call TMDB with a browser-exposed key —
 * Vercel often only has TMDB_API_KEY (server), not NEXT_PUBLIC_TMDB_API_KEY.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") || searchParams.get("query") || "").trim();

  if (query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const apiKey = process.env.TMDB_API_KEY || process.env.NEXT_PUBLIC_TMDB_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "TMDB_API_KEY is not configured", results: [] },
      { status: 500 }
    );
  }

  const url = new URL("https://api.themoviedb.org/3/search/multi");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("query", query);

  try {
    const res = await fetch(url.toString(), {
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `TMDB error ${res.status}`, results: [] },
        { status: 502 }
      );
    }
    const data = await res.json();
    const results = (data.results || [])
      .filter(
        (r: { media_type?: string }) =>
          r.media_type === "tv" || r.media_type === "movie"
      )
      .slice(0, 10);

    return NextResponse.json({ results });
  } catch (err) {
    console.error("Search API failed:", err);
    return NextResponse.json(
      { error: "Search failed", results: [] },
      { status: 500 }
    );
  }
}
