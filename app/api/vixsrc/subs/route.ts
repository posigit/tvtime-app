import { NextRequest, NextResponse } from "next/server";

/**
 * OpenSubtitles (opensubtitles.com) subtitle lookup, gated on env:
 *   OPENSUBTITLES_API_KEY  — required (free account: https://opensubtitles.com)
 *   OPENSUBTITLES_USERNAME / OPENSUBTITLES_PASSWORD — optional; without them we
 *     still search, but the download endpoint needs an auth token, so set both.
 *
 * Used by the player as a fallback when vixsrc's stream has no English CC.
 * Returns VTT text (converted from SRT server-side).
 */
export const dynamic = "force-dynamic";

const OS_BASE = "https://api.opensubtitles.com/api/v1";

// In-memory token cache (per serverless instance; re-login on cold start).
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  const apiKey = process.env.OPENSUBTITLES_API_KEY;
  const username = process.env.OPENSUBTITLES_USERNAME;
  const password = process.env.OPENSUBTITLES_PASSWORD;
  if (!apiKey) throw new Error("OPENSUBTITLES_API_KEY not configured");
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  if (!username || !password) throw new Error("OPENSUBTITLES_USERNAME/PASSWORD not configured");

  const res = await fetch(`${OS_BASE}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Api-Key": apiKey,
      "User-Agent": "tvtime-app",
    },
    body: JSON.stringify({ username, password }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`opensubtitles login ${res.status}`);
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("opensubtitles login returned no token");
  // Tokens are long-lived; refresh conservatively every 12h.
  cachedToken = { token: data.token, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
  return data.token;
}

function srtToVtt(srt: string): string {
  const cleaned = srt
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
    .replace(/\n{3,}/g, "\n\n");
  const body = cleaned
    .split("\n")
    .filter((line) => !/^\d+$/.test(line.trim()))
    .join("\n")
    .trim();
  return `WEBVTT\n\n${body}\n`;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const imdbId = sp.get("imdbId");
  const season = sp.get("season");
  const episode = sp.get("episode");
  const lang = sp.get("lang") || "en";

  if (!imdbId) {
    return NextResponse.json({ error: "imdbId required" }, { status: 400 });
  }
  if (!process.env.OPENSUBTITLES_API_KEY) {
    return NextResponse.json(
      { error: "OpenSubtitles not configured" },
      { status: 501 }
    );
  }

  try {
    const token = await getToken();
    const apiKey = process.env.OPENSUBTITLES_API_KEY;

    // 1. Search English subs for the movie / episode.
    const searchParams = new URLSearchParams({
      imdb_id: imdbId.replace(/^tt/, ""),
      languages: lang,
      order_download_count: "desc",
    });
    if (season && episode) {
      searchParams.set("season_number", season);
      searchParams.set("episode_number", episode);
    }
    const searchRes = await fetch(`${OS_BASE}/subtitles?${searchParams}`, {
      headers: {
        "Api-Key": apiKey!,
        Authorization: `Bearer ${token}`,
        "User-Agent": "tvtime-app",
      },
      cache: "no-store",
    });
    if (!searchRes.ok) throw new Error(`opensubtitles search ${searchRes.status}`);
    const search = (await searchRes.json()) as {
      data?: Array<{
        attributes?: {
          files?: Array<{ file_id?: number }>;
          sub_format?: string;
          language?: string;
          download_count?: number;
          release_name?: string;
        };
      }>;
    };
    const subs = (search.data ?? []).filter(
      (s) =>
        s.attributes?.files?.[0]?.file_id &&
        // Hard English filter — never return Italian subs.
        (s.attributes.language ?? "").toLowerCase().startsWith("en")
    );
    if (subs.length === 0) {
      return NextResponse.json(
        { error: "no subtitles found" },
        { status: 404 }
      );
    }

    // 2. Pick the best: prefer vtt, then srt, by download count.
    const best = [...subs].sort((a, b) => {
      const fmt = (f?: string) => (f === "vtt" ? 0 : f === "srt" ? 1 : 2);
      const aFmt = fmt(a.attributes?.sub_format);
      const bFmt = fmt(b.attributes?.sub_format);
      if (aFmt !== bFmt) return aFmt - bFmt;
      return (b.attributes?.download_count ?? 0) - (a.attributes?.download_count ?? 0);
    })[0];
    const fileId = best.attributes?.files?.[0]?.file_id;
    if (!fileId) throw new Error("subtitle file has no file_id");

    // 3. Download (returns a signed link).
    const dlRes = await fetch(`${OS_BASE}/download`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Key": apiKey!,
        Authorization: `Bearer ${token}`,
        "User-Agent": "tvtime-app",
      },
      body: JSON.stringify({ file_id: fileId }),
      cache: "no-store",
    });
    if (!dlRes.ok) throw new Error(`opensubtitles download ${dlRes.status}`);
    const dl = (await dlRes.json()) as { link?: string };
    if (!dl.link) throw new Error("opensubtitles download returned no link");

    const fileRes = await fetch(dl.link, { cache: "no-store" });
    if (!fileRes.ok) throw new Error(`subtitle file ${fileRes.status}`);
    const raw = await fileRes.text();

    const isVtt = best.attributes?.sub_format === "vtt";
    const vtt = isVtt
      ? raw.replace(/^\uFEFF/, "")
      : srtToVtt(raw);

    return NextResponse.json({
      vtt,
      label: best.attributes?.release_name ?? "OpenSubtitles (English)",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "subtitle lookup failed" },
      { status: 502 }
    );
  }
}
