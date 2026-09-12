/**
 * IntroDB segment timestamps (intro / recap / outro) for TV episodes.
 *
 * Read API is free with no key: GET /segments?imdb_id=&season=&episode=.
 * We proxy through /api/introdb/segments (cached 24h, episode data is
 * static) so the client never touches the third party directly.
 */

export type IntroDbSegment = { start: number; end: number };
export type IntroDbSegments = {
  intro: IntroDbSegment | null;
  recap: IntroDbSegment | null;
  outro: IntroDbSegment | null;
};

export const EMPTY_SEGMENTS: IntroDbSegments = {
  intro: null,
  recap: null,
  outro: null,
};

/**
 * Parse seconds from IntroDB's loose format: plain numbers or clock-style
 * strings ("mm:ss", "hh:mm:ss"). Null for anything unparseable/negative.
 */
export function parseSegmentSec(value: unknown): number | null {
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
    const [h, m, s] =
      parts.length === 3
        ? parts
        : [0, parts[0], parts[1]];
    return h! * 3600 + m! * 60 + s!;
  }
  return null;
}

type RawSegment = {
  start_sec?: unknown;
  end_sec?: unknown;
  start_ms?: unknown;
  end_ms?: unknown;
  /** Already-normalized shape from our own /api/introdb/segments proxy. */
  start?: unknown;
  end?: unknown;
} | null | undefined;

/** Normalize one raw segment ({start_sec,end_sec}, ms, or proxy {start,end}). */
export function normalizeSegment(raw: RawSegment): IntroDbSegment | null {
  if (!raw || typeof raw !== "object") return null;
  // Our proxy already normalizes — accept its output verbatim (validated).
  const directStart = parseSegmentSec(raw.start);
  const directEnd = parseSegmentSec(raw.end);
  if (directStart != null && directEnd != null && directEnd > directStart) {
    return { start: directStart, end: directEnd };
  }
  let start = parseSegmentSec(raw.start_sec);
  let end = parseSegmentSec(raw.end_sec);
  if (start == null || end == null) {
    const startMs = parseSegmentSec(raw.start_ms);
    const endMs = parseSegmentSec(raw.end_ms);
    if (startMs == null || endMs == null) return null;
    start = startMs / 1000;
    end = endMs / 1000;
  }
  if (!(end > start)) return null;
  return { start, end };
}

/** Fetch cached segments for an episode. Never throws (nulls on failure). */
export async function fetchSegments(opts: {
  imdbId: string;
  season: number;
  episode: number;
}): Promise<IntroDbSegments> {
  try {
    const q = new URLSearchParams({
      imdbId: opts.imdbId,
      season: String(opts.season),
      episode: String(opts.episode),
    });
    const res = await fetch(`/api/introdb/segments?${q.toString()}`);
    if (!res.ok) return EMPTY_SEGMENTS;
    const data = (await res.json()) as {
      intro?: RawSegment;
      recap?: RawSegment;
      outro?: RawSegment;
    };
    return {
      intro: normalizeSegment(data.intro),
      recap: normalizeSegment(data.recap),
      outro: normalizeSegment(data.outro),
    };
  } catch {
    return EMPTY_SEGMENTS;
  }
}
