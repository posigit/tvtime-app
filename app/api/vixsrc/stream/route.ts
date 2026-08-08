import { NextRequest, NextResponse } from "next/server";
import { VIX_LANG } from "@/lib/vixsrc";

/**
 * VixSrc native stream resolver.
 *
 * vixsrc.to guards its HTML pages with Cloudflare bot protection (challenge in
 * cross-site iframes, blocks *.vercel.app referers), but its JSON/API and HLS
 * endpoints are open and CORS-permissive. Most of the app's hosts are
 * Cloudflare-blocked (Vercel returns 403, public proxies return 403/52x), so
 * on production the resolution happens on a small standalone service
 * (resolver-server/) deployed on a network vixsrc accepts — pass its base URL
 * as VIX_RESOLVER_URL. When unset, this route resolves directly (e.g.
 * localhost).
 *
 * Both paths hand back a playable master playlist URL:
 *
 *   /api/movie|tv/{id}  ->  signed embed src  ->  embed page masterPlaylist  ->  m3u8
 *
 * The client then plays the m3u8 natively (hls.js) — no iframe, no CF challenge,
 * no third-party cookies, works from any origin.
 */
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function fetchImdbId(type: string, id: string): Promise<string | null> {
  if (!process.env.TMDB_API_KEY) return null;
  const extPath =
    type === "tv" ? `/tv/${id}/external_ids` : `/movie/${id}/external_ids`;
  try {
    const extRes = await fetch(
      `https://api.themoviedb.org/3${extPath}?api_key=${process.env.TMDB_API_KEY}`,
      { cache: "no-store" }
    );
    if (extRes.ok) {
      const ext = (await extRes.json()) as { imdb_id?: string | null };
      if (ext.imdb_id) return ext.imdb_id;
    }
  } catch {
    /* imdbId is optional — skip on failure */
  }
  return null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type"); // "movie" | "tv"
  const id = sp.get("id");
  const season = sp.get("season");
  const episode = sp.get("episode");

  if ((type !== "movie" && type !== "tv") || !id) {
    return NextResponse.json(
      { error: "type (movie|tv) and id are required" },
      { status: 400 }
    );
  }

  const resolver = process.env.VIX_RESOLVER_URL?.replace(/\/+$/, "");

  // Deployed path: resolve from a non-blocked service, then enrich with IMDb.
  if (resolver) {
    try {
      const rp = new URLSearchParams({
        type,
        id,
      });
      if (season != null) rp.set("season", season);
      if (episode != null) rp.set("episode", episode);
      const res = await fetch(`${resolver}/stream?${rp.toString()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const data = await res.json();
        // The resolver hands back a RELATIVE /media?url=... (it proxies the
        // playlist + segments through itself). Prefix the resolver base so
        // hls.js fetches the whole chain from the resolver, which vixsrc
        // accepts — the browser could never fetch vixsrc.to directly (403).
        let playlistUrl = data.playlistUrl;
        if (typeof playlistUrl === "string" && playlistUrl.startsWith("/media")) {
          playlistUrl = `${resolver}${playlistUrl}`;
        }
        return NextResponse.json({
          ...data,
          playlistUrl,
          imdbId: await fetchImdbId(type, id),
        });
      }
      // Non-2xx from the resolver: fall through to the direct attempt.
    } catch {
      // Resolver unreachable/error: fall through to the direct attempt.
    }
  }

  const mediaPath =
    type === "tv" ? `tv/${id}/${season}/${episode}` : `movie/${id}`;
  const referer = `https://vixsrc.to/${mediaPath}`;

  try {
    // 1. API route -> signed embed src (no CF challenge on JSON endpoints)
    const apiRes = await fetch(`https://vixsrc.to/api/${mediaPath}`, {
      headers: { "User-Agent": UA, Referer: referer, Accept: "application/json" },
      cache: "no-store",
    });
    if (!apiRes.ok) throw new Error(`vixsrc api ${apiRes.status}`);
    const apiJson = (await apiRes.json()) as { src?: string };
    if (!apiJson.src) throw new Error("vixsrc api returned no src");

    // 2. Embed page -> master playlist url + signed params
    const embedRes = await fetch(`https://vixsrc.to${apiJson.src}`, {
      headers: { "User-Agent": UA, Referer: referer },
      cache: "no-store",
    });
    if (!embedRes.ok) throw new Error(`vixsrc embed ${embedRes.status}`);
    const html = await embedRes.text();

    const urlMatch = html.match(
      /window\.masterPlaylist\s*=\s*\{[\s\S]*?url:\s*'([^']+)'/
    );
    if (!urlMatch) throw new Error("no master playlist in embed page");

    const grab = (key: string) =>
      html.match(new RegExp(`'${key}':\\s*'([^']*)'`))?.[1] ?? "";
    const thumbMatch = html.match(/window\.thumbnailsUrl\s*=\s*'([^']+)'/);

    const params = new URLSearchParams();
    const token = grab("token");
    const expires = grab("expires");
    const asn = grab("asn");
    if (token) params.set("token", token);
    if (expires) params.set("expires", expires);
    if (asn) params.set("asn", asn);
    // The embed player appends these exactly like this (see vixsrc embed JS):
    params.set("h", "1");
    params.set("lang", VIX_LANG);

    // masterPlaylist.url may already carry a query (e.g. ?b=1) — append via
    // URLSearchParams so the existing query survives.
    const playlist = new URL(urlMatch[1]);
    for (const [k, v] of params) playlist.searchParams.set(k, v);

    return NextResponse.json({
      playlistUrl: playlist.toString(),
      thumbnailsUrl: thumbMatch?.[1] ?? null,
      imdbId: await fetchImdbId(type, id),
      season: type === "tv" ? season : null,
      episode: type === "tv" ? episode : null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "vixsrc stream failed" },
      { status: 502 }
    );
  }
}