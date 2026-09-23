import { NextRequest, NextResponse } from "next/server";
import { vidsrcShResolve } from "@/lib/vidsrc-sh";

/**
 * data.vidsrc.sh resolver endpoint.
 *
 * Mirrors /api/vixsrc/stream's shape where it matters: accept
 * type/id/season/episode, return direct stream URLs (decrypted server-side).
 * Unlike vixsrc.to, this host is NOT (yet) known to Cloudflare-block
 * datacenter egress — this route doubles as the reachability verdict:
 * URLs flowing here means native playback + downloads without new infra.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type");
  const idRaw = sp.get("id");
  const season = sp.get("season");
  const episode = sp.get("episode");

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
    const r = await vidsrcShResolve({
      type,
      id,
      season: season != null ? Number(season) : undefined,
      episode: episode != null ? Number(episode) : undefined,
    });
    if (r.urls.length === 0) {
      return NextResponse.json(
        {
          error: "no streams for this title",
          code: "no_streams",
          title: r.title,
          imdbId: r.imdbId,
        },
        { status: 404 }
      );
    }
    return NextResponse.json({
      // Proxied master: tokens are IP-bound to this deployment, so the
      // browser must go through /api/vidsrc-sh/media (which mints + proxies).
      playlistUrl: `/api/vidsrc-sh/media?url=${encodeURIComponent(r.urls[0])}`,
      playlistUrls: r.urls.map(
        (u) => `/api/vidsrc-sh/media?url=${encodeURIComponent(u)}`
      ),
      title: r.title,
      imdbId: r.imdbId,
      fileName: r.fileName,
      thumbnailsUrl: r.thumbnailsUrl,
      subtitles: r.subtitles,
      sourceApi: "vidsrc-sh",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "vidsrc-sh failed";
    return NextResponse.json(
      {
        error: message,
        code: "upstream_unreachable",
        detail:
          "data.vidsrc.sh unreachable from this deployment (blocked, down, or format change).",
      },
      { status: 502 }
    );
  }
}
