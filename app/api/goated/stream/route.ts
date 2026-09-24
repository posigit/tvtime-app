import { NextRequest, NextResponse } from "next/server";
import { goatedResolve } from "@/lib/goated";
import { fetchWithTimeout, parseMediaParams } from "@/lib/stream-proxy";

/**
 * goated.cx stream resolver endpoint.
 *
 * Mirrors /api/vixsrc/stream: accept type/id/season/episode, resolve to a
 * playable master playlist, return { url, source, imdbId }.
 *
 * Single PoW: ONLY resolves the video. Subtitles are Tier 1 — the player
 * builds the VDRK VTT URL directly from tmdbId (no API call, no PoW), and
 * Tier 3 OpenSubtitles fallback uses the imdbId returned here.
 *
 * Unlike vixsrc, goated's media is referer-locked — the returned url is NOT
 * safe for the browser to fetch cross-origin. The player must load it THROUGH
 * the /api/goated/media proxy (which spoofs the goated referer + rewrites
 * playlist URLs). We pass the *media proxy rewrite* of the master URL and let
 * the player treat it as the playlist source.
 */

export const dynamic = "force-dynamic";

async function fetchImdbId(type: "movie" | "tv", id: number): Promise<string | null> {
  if (!process.env.TMDB_API_KEY) return null;
  const extPath = type === "tv" ? `/tv/${id}/external_ids` : `/movie/${id}/external_ids`;
  try {
    const extRes = await fetchWithTimeout(
      `https://api.themoviedb.org/3${extPath}?api_key=${process.env.TMDB_API_KEY}`,
      { cache: "no-store" },
      8_000
    );
    if (extRes.ok) {
      const ct = extRes.headers.get("content-type") ?? "";
      if (!ct.includes("json")) return null;
      const ext = (await extRes.json()) as { imdb_id?: string | null };
      if (ext.imdb_id) return ext.imdb_id;
    }
  } catch {
    /* imdbId is optional — skip on failure */
  }
  return null;
}

export async function GET(req: NextRequest) {
  let params: ReturnType<typeof parseMediaParams>;
  try {
    params = parseMediaParams(req.nextUrl.searchParams);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "bad request" },
      { status: 400 }
    );
  }
  const source = req.nextUrl.searchParams.get("source") || "Orbit";

  try {
    const resolved = await goatedResolve({
      type: params.type,
      id: params.id,
      season: params.season,
      episode: params.episode,
      source: source === "Valenox" ? "Valenox" : "Orbit",
    });

    // Return the raw signed url; the player routes it through the media proxy.
    // imdbId feeds the Tier 3 OpenSubtitles fallback.
    return NextResponse.json({
      url: resolved.url,
      source: resolved.source,
      availableSources: resolved.availableSources,
      imdbId: await fetchImdbId(params.type, params.id),
      sourceApi: "goated",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "goated stream failed";
    return NextResponse.json(
      {
        error: message,
        code: "upstream_unreachable",
        detail:
          "The goated backend is unreachable from this deployment (DNS / connection / TLS failure, not a missing title).",
      },
      { status: 502 }
    );
  }
}