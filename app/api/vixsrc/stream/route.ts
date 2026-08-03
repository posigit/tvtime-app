import { NextRequest, NextResponse } from "next/server";
import { VIX_LANG } from "@/lib/vixsrc";

/**
 * VixSrc native stream resolver.
 *
 * vixsrc.to guards its HTML pages with Cloudflare bot protection (challenge in
 * cross-site iframes, blocks *.vercel.app referers), but its JSON/API and HLS
 * endpoints are open and CORS-permissive. This route resolves the full chain
 * server-side and hands back a playable master playlist URL:
 *
 *   /api/movie|tv/{id}  ->  signed embed src  ->  embed page masterPlaylist  ->  m3u8
 *
 * The client then plays the m3u8 natively (hls.js) — no iframe, no CF challenge,
 * no third-party cookies, works from any origin.
 */
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "vixsrc stream failed" },
      { status: 502 }
    );
  }
}
