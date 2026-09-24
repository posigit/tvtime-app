import { NextRequest, NextResponse } from "next/server";
import { signProxyUrl, vidsrcShResolve } from "@/lib/vidsrc-sh";
import { parseMediaParams } from "@/lib/stream-proxy";

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
  let params: ReturnType<typeof parseMediaParams>;
  try {
    params = parseMediaParams(req.nextUrl.searchParams);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "bad request" },
      { status: 400 }
    );
  }

  try {
    const r = await vidsrcShResolve(params);
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
    const playlistUrls: string[] = [];
    for (const u of r.urls) {
      try {
        playlistUrls.push(await signProxyUrl(u));
      } catch {
        /* skip unsignable */
      }
    }
    if (playlistUrls.length === 0) {
      return NextResponse.json(
        { error: "failed to sign streams", code: "sign_failed" },
        { status: 502 }
      );
    }
    return NextResponse.json({
      // Proxied master: tokens are IP-bound to this deployment, so the
      // browser must go through /api/vidsrc-sh/media (which mints + proxies).
      // Signed with expiry: the media route only serves URLs minted here.
      playlistUrl: playlistUrls[0],
      playlistUrls,
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
