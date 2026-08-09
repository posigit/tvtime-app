import { NextRequest, NextResponse } from "next/server";
import { GOATED_ORIGIN } from "@/lib/goated";

/**
 * goated media proxy.
 *
 * goated's playlists (cdn.reallyfast.xyz) and segments (hls.cdn8012.workers.dev)
  * are referer + CORS locked to https://goated.cx. This route re-hosts them on
  * the app's own origin so hls.js can play them same-origin.
  * Valenox backend serves through hls-proxy.cdn8012.workers.dev (same family,
  * allowlisted too — 2026-08-09).
 *
 * Contract (stream route hands OUT these URLs):
 *   /api/goated/media?url=<enc(https://cdn.reallyfast.xyz/playlist/xxx.m3u8?t=..&s=..)>
 *
 * Behavior:
 *   - Fetch the target with Referer: https://goated.cxy, forward Range headers.
 *   - If the body is a playlist (text m3u8), rewrite EVERY absolute .m3u8 /
 *     segment URL to a new /api/goated/media?url=... proxy path so hls.js
 *     follows the whole chain through us.
 *   - Otherwise (fMP4 segments .m4s / init / audio) pass bytes through with
 *     Range support (Accept-Ranges: bytes — scrubbing works).
 */

export const dynamic = "force-dynamic";

// Hosts whose absolute URLs we rewrite into proxy calls.
const REWRITE_HOSTS = new Set([
  "cdn.reallyfast.xyz",
  "hls.cdn8012.workers.dev",
  "hls-proxy.cdn8012.workers.dev", // Valenox backend (same reallyfast family)
]);

function isPlaylistContentType(ct: string | null): boolean {
  return !!ct && ct.includes("mpegurl");
}

function rewriteBody(body: string): string {
  // Rewrite every absolute URL on a tracked host to the proxy. Also make
  // protocol-relative (//) and any quoted URL safe.
  return body.replace(
    /https?:\/\/[a-z0-9.-]+(\/[^\s"']+)/gi,
    (full: string) => {
      try {
        const u = new URL(full);
        if (!REWRITE_HOSTS.has(u.hostname)) return full;
        return `/api/goated/media?url=${encodeURIComponent(full)}`;
      } catch {
        return full;
      }
    }
  );
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  // Only proxy the hosts we intend to — never an open redirect.
  if (!REWRITE_HOSTS.has(parsed.hostname)) {
    return NextResponse.json(
      { error: "host not allowed" },
      { status: 403 }
    );
  }

  const range = req.headers.get("range");
  try {
    const upstream = await fetch(target, {
      headers: {
        Referer: GOATED_ORIGIN + "/",
        Origin: GOATED_ORIGIN,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "*/*",
        ...(range ? { Range: range } : {}),
      },
      cache: "no-store",
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `upstream ${upstream.status}` },
        { status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 }
      );
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (isPlaylistContentType(contentType)) {
      const text = await upstream.text();
      const rewritten = rewriteBody(text);
      return new NextResponse(rewritten, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store",
        },
      });
    }

    // Binary pass-through (segments/init/aes key). Forward Range reply / ACC-Ranges.
    const headers = new Headers({
      "Content-Type": contentType || "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
      "Accept-Ranges": "bytes",
    });
    if (upstream.headers.get("content-range")) {
      headers.set("Content-Range", upstream.headers.get("content-range")!);
    }
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "proxy failed" },
      { status: 502 }
    );
  }
}