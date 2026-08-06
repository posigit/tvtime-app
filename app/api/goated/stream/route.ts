import { NextRequest, NextResponse } from "next/server";
import { goatedResolve } from "@/lib/goated";

/**
 * goated.cx stream resolver endpoint.
 *
 * Mirrors /api/vixsrc/stream: accept type/id/season/episode, resolve to a
 * playable master playlist, return { url, source, subtitles, imdbId }.
 *
 * Unlike vixsrc, goated's media is referer-locked — the returned url is NOT
 * safe for the browser to fetch cross-origin. The player must load it THROUGH
 * the /api/goated/media proxy (which spoofs the goated referer + rewrites
 * playlist URLs). We pass the *media proxy rewrite* of the master URL and let
 * the player treat it as the playlist source.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type");
  const idRaw = sp.get("id");
  const season = sp.get("season");
  const episode = sp.get("episode");
  const source = sp.get("source") || "Orbit";

  if ((type !== "movie" && type !== "tv") || !idRaw) {
    return NextResponse.json(
      { error: "type (movie|tv) and id are required" },
      { status: 400 }
    );
  }
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const resolved = await goatedResolve({
      type,
      id,
      season: season != null ? Number(season) : undefined,
      episode: episode != null ? Number(episode) : undefined,
      source: source === "Valenox" ? "Valenox" : "Orbit",
    });

    // Return the raw signed url; the player routes it through the media proxy.
    return NextResponse.json({
      url: resolved.url,
      source: resolved.source,
      availableSources: resolved.availableSources,
      subtitles: resolved.subtitles,
      imdbId: null, // kept for vixsrc-shape parity; goated keys on tmdb
      sourceApi: "goated",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "goated stream failed" },
      { status: 502 }
    );
  }
}