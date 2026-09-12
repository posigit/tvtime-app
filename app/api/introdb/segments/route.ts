import { NextRequest, NextResponse } from "next/server";

/**
 * IntroDB segment proxy (intro / recap / outro timestamps per episode).
 *
 * GET ?imdbId=tt1234567&season=1&episode=2
 *   → { intro: {start,end} | null, recap: … | null, outro: … | null }
 *   (seconds; null when IntroDB has no data for the slot)
 *
 * Episode data is static, so responses cache for 24h. Upstream needs no key.
 */
export const dynamic = "force-dynamic";

const INTRODB_BASE = "https://api.introdb.app";

function toSeconds(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return null;
    if (/^\d+(\.\d+)?$/.test(t)) {
      const n = Number(t);
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
    const parts = t.split(":").map((p) => Number(p));
    if (
      parts.length < 2 ||
      parts.length > 3 ||
      parts.some((p) => !Number.isFinite(p) || p < 0)
    ) {
      return null;
    }
    const [h, m, s] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
    return (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0);
  }
  return null;
}

function normalize(raw: unknown): { start: number; end: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as {
    start_sec?: unknown;
    end_sec?: unknown;
    start_ms?: unknown;
    end_ms?: unknown;
  };
  let start = toSeconds(r.start_sec);
  let end = toSeconds(r.end_sec);
  if (start == null || end == null) {
    const startMs = toSeconds(r.start_ms);
    const endMs = toSeconds(r.end_ms);
    if (startMs == null || endMs == null) return null;
    start = startMs / 1000;
    end = endMs / 1000;
  }
  if (!(end > start)) return null;
  return { start, end };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const imdbId = sp.get("imdbId");
  const season = sp.get("season");
  const episode = sp.get("episode");
  if (!imdbId || !season || !episode) {
    return NextResponse.json(
      { error: "imdbId, season and episode are required" },
      { status: 400 }
    );
  }

  try {
    const q = new URLSearchParams({
      imdb_id: imdbId,
      season,
      episode,
    });
    const res = await fetch(`${INTRODB_BASE}/segments?${q.toString()}`, {
      next: { revalidate: 86400 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { intro: null, recap: null, outro: null },
        {
          headers: { "Cache-Control": "public, s-maxage=3600" },
        }
      );
    }
    const data = (await res.json()) as {
      intro?: unknown;
      recap?: unknown;
      outro?: unknown;
    };
    return NextResponse.json(
      {
        intro: normalize(data.intro),
        recap: normalize(data.recap),
        outro: normalize(data.outro),
      },
      {
        headers: { "Cache-Control": "public, s-maxage=86400" },
      }
    );
  } catch {
    return NextResponse.json(
      { intro: null, recap: null, outro: null },
      {
        headers: { "Cache-Control": "public, s-maxage=3600" },
      }
    );
  }
}
