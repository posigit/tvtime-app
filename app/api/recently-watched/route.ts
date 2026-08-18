import { and, desc, eq, inArray } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db, withDbRetry } from "@/lib/db";
import { episodes, movies, shows, users, watchHistory } from "@/lib/schema";

export const dynamic = "force-dynamic";

const POSTER_BASE = "https://image.tmdb.org/t/p/w500";

function isAuthorized(request: Request): boolean {
  const expected = process.env.RECENTLY_WATCHED_API_KEY;
  if (!expected) return false; // secure by default: no key configured = closed
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided || provided.length !== expected.length) return false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

interface WatchedItem {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  year: string | null;
  detail: string | null;
  episodeTitle: string | null;
  rating: number | null;
  watchedAt: string;
  source: string;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: "unauthorized", message: "Missing or invalid API key." },
      { status: 401, headers: corsHeaders() }
    );
  }
  try {
    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 10, 1), 25);
    const handle = url.searchParams.get("user");

    // Resolve the public user
    let publicUser;
    if (handle) {
      const found = await withDbRetry(() =>
        db
          .select()
          .from(users)
          .where(and(eq(users.publicHandle, handle), eq(users.publicProfile, true)))
          .limit(1)
      );
      publicUser = found[0];
    } else {
      const found = await withDbRetry(() =>
        db
          .select()
          .from(users)
          .where(eq(users.publicProfile, true))
          .orderBy(desc(users.createdAt))
          .limit(1)
      );
      publicUser = found[0];
    }

    if (!publicUser) {
      return NextResponse.json(
        { error: "not_configured", message: "No public profile is configured on this instance." },
        { status: 404, headers: corsHeaders() }
      );
    }

    // Recent watch events — fetch extra to absorb dedupe
    const events = await withDbRetry(() =>
      db
        .select()
        .from(watchHistory)
        .where(eq(watchHistory.userId, publicUser.id))
        .orderBy(desc(watchHistory.watchedAt))
        .limit(limit * 4)
    );

    if (events.length === 0) {
      return NextResponse.json([], { headers: cacheHeaders() });
    }

    // Metadata lookups
    const movieIds = [...new Set(events.filter((e) => e.mediaType === "movie").map((e) => e.tmdbId))];
    const showIds = [...new Set(events.filter((e) => e.mediaType === "tv").map((e) => e.tmdbId))];

    const moviesMeta = new Map<number, typeof movies.$inferSelect>();
    if (movieIds.length > 0) {
      const rows = await withDbRetry(() =>
        db.select().from(movies).where(inArray(movies.tmdbId, movieIds))
      );
      for (const r of rows) moviesMeta.set(r.tmdbId, r);
    }

    const showsMeta = new Map<number, typeof shows.$inferSelect>();
    if (showIds.length > 0) {
      const rows = await withDbRetry(() =>
        db.select().from(shows).where(inArray(shows.tmdbId, showIds))
      );
      for (const r of rows) showsMeta.set(r.tmdbId, r);
    }

    // Episode titles for tv events (last-watched episode per show)
    const episodeKeys = events
      .filter((e) => e.mediaType === "tv" && e.seasonNumber > 0)
      .map((e) => ({ showTmdbId: e.tmdbId, seasonNumber: e.seasonNumber, episodeNumber: e.episodeNumber }));
    const episodeMeta = new Map<string, string>();
    if (episodeKeys.length > 0) {
      const rows = await withDbRetry(() =>
        db
          .select()
          .from(episodes)
          .where(
            inArray(
              episodes.showTmdbId,
              [...new Set(episodeKeys.map((k) => k.showTmdbId))]
            )
          )
      );
      for (const r of rows) {
        episodeMeta.set(`${r.showTmdbId}|${r.seasonNumber}|${r.episodeNumber}`, r.title);
      }
    }

    // Dedupe by tmdbId — keep most recent event; for tv, remember last episode detail
    const seen = new Set<number>();
    const items: WatchedItem[] = [];
    for (const event of events) {
      if (seen.has(event.tmdbId)) continue;
      seen.add(event.tmdbId);

      const isMovie = event.mediaType === "movie";
      const meta = isMovie ? moviesMeta.get(event.tmdbId) : showsMeta.get(event.tmdbId);
      const dateStr = meta ? ("releaseDate" in meta ? meta.releaseDate : meta.firstAirDate) : null;

      items.push({
        tmdbId: event.tmdbId,
        mediaType: isMovie ? "movie" : "tv",
        title: meta?.title ?? `Title ${event.tmdbId}`,
        posterUrl: meta?.posterPath ? `${POSTER_BASE}${meta.posterPath}` : null,
        backdropUrl: meta?.backdropPath ? `${POSTER_BASE}${meta.backdropPath}` : null,
        year: dateStr ? String(dateStr).slice(0, 4) : null,
        detail:
          isMovie || !event.seasonNumber
            ? null
            : `S${event.seasonNumber} E${event.episodeNumber}`,
        episodeTitle: isMovie
          ? null
          : episodeMeta.get(`${event.tmdbId}|${event.seasonNumber}|${event.episodeNumber}`) || null,
        rating: meta?.voteAverage ?? null,
        watchedAt: event.watchedAt.toISOString(),
        source: event.source,
      });

      if (items.length >= limit) break;
    }

    return NextResponse.json(items, {
      headers: { ...cacheHeaders(), ...corsHeaders() },
    });
  } catch (error) {
    console.error("recently-watched error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500, headers: corsHeaders() });
  }
}

function cacheHeaders(): Record<string, string> {
  return {
    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
  };
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
