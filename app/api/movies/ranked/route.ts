import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLibraryState } from "@/lib/explore-digest";
import {
  discoverMoviesByDecade,
  discoverMoviesByYear,
} from "@/lib/tmdb";

function parseDecadeStart(raw: string): number | null {
  const m = raw.match(/^(\d{4})s$/);
  const start = Number(m?.[1]);
  const now = new Date().getFullYear();
  if (!Number.isInteger(start) || start % 10 !== 0) return null;
  if (start < 1900 || start > now) return null;
  return start;
}

/** Paginated ranked slices for year/decade Show More. No ownership filtering — rankings stay complete. */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized", items: [] }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind");
  const value = searchParams.get("value") ?? "";
  const page = Math.max(1, Math.min(50, Number(searchParams.get("page")) || 1));

  try {
    if (kind === "year") {
      const year = Number(value);
      const now = new Date().getFullYear();
      if (!Number.isInteger(year) || year < 1900 || year > now + 1) {
        return NextResponse.json({ error: "Bad year", items: [] }, { status: 400 });
      }
      const [{ items, totalPages, totalResults }, library] = await Promise.all([
        discoverMoviesByYear(year, page),
        getLibraryState(session.user.id),
      ]);
      return NextResponse.json({
        items,
        totalPages,
        totalResults,
        statuses: Object.fromEntries(library.movieStatusById),
      });
    }

    if (kind === "decade") {
      const start = parseDecadeStart(value);
      if (start == null) {
        return NextResponse.json({ error: "Bad decade", items: [] }, { status: 400 });
      }
      const [{ items, totalPages, totalResults }, library] = await Promise.all([
        discoverMoviesByDecade(start, page),
        getLibraryState(session.user.id),
      ]);
      return NextResponse.json({
        items,
        totalPages,
        totalResults,
        statuses: Object.fromEntries(library.movieStatusById),
      });
    }

    return NextResponse.json({ error: "Bad kind", items: [] }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "TMDB failed", items: [] }, { status: 502 });
  }
}
