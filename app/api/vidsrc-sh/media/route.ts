import { NextRequest, NextResponse } from "next/server";
import { gunzipSync } from "zlib";
import {
  applyVidsrcToken,
  signProxyUrl,
  verifyProxyUrl,
  vidsrcShOrigin,
  vidsrcShToken,
} from "@/lib/vidsrc-sh";

/**
 * vidsrc-sh media proxy.
 *
 * Stream URLs are JWT-gated AND IP-bound (/24) to the minter's network, so
 * the browser can never fetch them directly — the token would fail the IP
 * check. This route mints server-side and re-hosts playlists + segments on
 * the app's own origin so hls.js plays same-origin (and downloads work).
 *
 * Contract (stream route hands OUT these URLs):
 *   /api/vidsrc-sh/media?url=<enc(https://<host>/pl/<gzip-blob>)>
 *
 * Behavior:
 *   - Ensure ?token= (mint per-origin, cached ~1h) before fetching.
 *   - Playlists (m3u8 by content-type OR #EXTM3U sniffing): rewrite EVERY
 *     absolute https URL through this proxy (SSRF-guarded, see below).
 *   - Segments / init / keys: byte pass-through with Range support.
 */
export const dynamic = "force-dynamic";

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "[::1]") return true;
  if (/^127\./.test(h) || /^0\./.test(h)) return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true;
  return false;
}

function isPlaylistContentType(ct: string | null): boolean {
  return !!ct && ct.includes("mpegurl");
}

function toProxy(full: string): string | null {
  try {
    const u = new URL(full);
    if (u.protocol !== "https:" || isBlockedHost(u.hostname)) return null;
    return signProxyUrl(full);
  } catch {
    return null;
  }
}

/**
 * Rewrite every playlist reference through this proxy, resolved against the
 * TRUE target (the ?url= param) — not our own proxy URL. Covers:
 *  1. absolute https URLs,
 *  2. absolute-path URIs (URI="/storage/enc.key") → target origin,
 *  3. bare relative lines (variant/segment file names) → target directory.
 * Without (2)+(3), hls.js and the download engine resolve relatives against
 * /api/vidsrc-sh/… (no such route) and die with 404s.
 */
function rewriteBody(body: string, base: URL): string {
  const proxied = (ref: string): string | null => {
    try {
      return toProxy(new URL(ref, base).toString());
    } catch {
      return null;
    }
  };
  // 2. Quoted URI attributes (EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA ...).
  let out = body.replace(
    /(URI=")([^"]*)(")/g,
    (full: string, pre: string, ref: string, post: string) => {
      if (!ref || ref.startsWith("data:")) return full;
      const p = proxied(ref);
      return p ? `${pre}${p}${post}` : full;
    }
  );
  // 1. Absolute URLs anywhere (also re-covers absolute results of step 2).
  out = out.replace(
    /https?:\/\/[a-z0-9.-]+(\/[^\s"']+)/gi,
    (full: string) => toProxy(full) ?? full
  );
  // 3. Bare non-# URI lines (relative variant/segment/key names).
  out = out
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return line;
      // Already rewritten above — never re-proxy (double-proxy corruption).
      if (t.startsWith("/api/")) return line;
      // Absolute URLs already handled above; skip other schemes (data:, etc).
      if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith("/")) return line;
      return proxied(t) ?? line;
    })
    .join("\n");
  return out;
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }
  // Only URLs minted by our own stream route (HMAC) are served — otherwise
  // this would be an open fetch proxy burning our bandwidth.
  if (!verifyProxyUrl(target, req.nextUrl.searchParams.get("sig"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 403 });
  }
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (parsed.protocol !== "https:" || isBlockedHost(parsed.hostname)) {
    return NextResponse.json({ error: "host not allowed" }, { status: 403 });
  }

  // Mint the playback token server-side (IP-bound to THIS deployment).
  let fetchUrl = target;
  try {
    if (!parsed.searchParams.has("token")) {
      const origin = vidsrcShOrigin(target);
      if (!origin) throw new Error("unparseable origin");
      const token = await vidsrcShToken(origin);
      fetchUrl = applyVidsrcToken(target, token);
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "token mint failed" },
      { status: 502 }
    );
  }

  const range = req.headers.get("range");
  try {
    const upstream = await fetch(fetchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Referer: "https://cloudorchestranova.com/",
        Accept: "*/*",
        ...(range ? { Range: range } : {}),
      },
      cache: "no-store",
    });
    if (!upstream.ok) {
      const retryAfter = upstream.headers.get("retry-after");
      return NextResponse.json(
        {
          error: `upstream ${upstream.status}`,
          retryable:
            upstream.status === 429 || upstream.status >= 500,
          ...(retryAfter ? { retryAfterSeconds: Number(retryAfter) || null } : {}),
        },
        {
          status:
            upstream.status >= 400 && upstream.status < 600
              ? upstream.status
              : 502,
        }
      );
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    const couldBePlaylist =
      isPlaylistContentType(contentType) ||
      contentType.includes("text") ||
      contentType === "";
    if (couldBePlaylist) {
      let buf = Buffer.from(await upstream.arrayBuffer());
      // Variant hosts sometimes serve gzipped playlist bytes (gzip magic
      // 1F 8B) with a generic content-type. Gunzip first — otherwise the
      // #EXTM3U sniff fails, the body passes through raw, and clients chase
      // direct (token IP-bound, residentially dead) URLs.
      if (
        buf.length > 2 &&
        buf[0] === 0x1f &&
        buf[1] === 0x8b
      ) {
        try {
          buf = gunzipSync(buf);
        } catch {
          /* corrupt gzip — fall through to raw handling below */
        }
      }
      const isPlaylist =
        buf.length > 6 && buf.subarray(0, 7).toString("latin1") === "#EXTM3U";
      if (isPlaylist) {
        return new NextResponse(rewriteBody(buf.toString("utf8"), parsed), {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "no-store",
          },
        });
      }
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": contentType || "application/octet-stream",
          "Content-Length": String(buf.length),
          "Accept-Ranges": "bytes",
        },
      });
    }

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
