/**
 * Shared Rotten Tomatoes page fetch + score parsing.
 *
 * RT's SSR HTML embeds a `mediaScorecard` JSON script with both scores:
 *   criticsScore.score  → Tomatometer (0–100)
 *   audienceScore.score → Popcornmeter (0–100)
 * The schema.org ld+json aggregateRating is kept as a Tomatometer fallback.
 *
 * Works for both /m/{slug} (movies) and /tv/{slug} (series).
 */

const RT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export type RtPagePrefix = "m" | "tv";

export type RtPageScores = {
  /** Tomatometer 0–100 (critics) */
  tomatometer: number | null;
  /** Popcornmeter 0–100 (audience) */
  audienceScore: number | null;
  /** certified-fresh | fresh | rotten | null */
  state: string | null;
  /** Page title from ld+json (for match verification) */
  name: string | null;
  /** schema.org @type from ld+json (Movie, TVSeries, …) */
  type: string | null;
};

export function toScore(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).match(/\d+/)?.[0]);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n);
}

function stateFromScore(
  score: number | null,
  certified: boolean,
  sentiment: string | null
): string | null {
  if (score == null) return null;
  if (certified && score >= 75) return "certified-fresh";
  if (sentiment && sentiment.toUpperCase() === "NEGATIVE") return "rotten";
  return score >= 60 ? "fresh" : "rotten";
}

/** Parse the `data-json="mediaScorecard"` script (both scores, one object). */
function parseMediaScorecard(html: string): {
  tomatometer: number | null;
  audienceScore: number | null;
  certified: boolean;
  sentiment: string | null;
} | null {
  const m = html.match(
    /<script[^>]*data-json="mediaScorecard"[^>]*>([\s\S]*?)<\/script>/i
  );
  if (!m) return null;
  try {
    const data = JSON.parse(m[1].trim()) as {
      criticsScore?: { score?: string | number; certified?: boolean; sentiment?: string };
      audienceScore?: { score?: string | number };
    };
    const tomatometer = toScore(data.criticsScore?.score);
    const audienceScore = toScore(data.audienceScore?.score);
    if (tomatometer == null && audienceScore == null) return null;
    return {
      tomatometer,
      audienceScore,
      certified: data.criticsScore?.certified === true,
      sentiment: data.criticsScore?.sentiment ?? null,
    };
  } catch {
    return null;
  }
}

/** ld+json: Tomatometer + page name/@type (also used to verify slug matches). */
function parseLdJson(html: string): {
  score: number | null;
  name: string | null;
  type: string | null;
} {
  const ldMatch = html.match(
    /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/i
  );
  if (!ldMatch) return { score: null, name: null, type: null };

  try {
    const data = JSON.parse(ldMatch[1]) as {
      "@type"?: string;
      name?: string;
      aggregateRating?: { ratingValue?: string | number };
    };
    return {
      score: toScore(data.aggregateRating?.ratingValue),
      name: data.name ?? null,
      type: data["@type"] ?? null,
    };
  } catch {
    return { score: null, name: null, type: null };
  }
}

/** Extract both RT scores from a title page's HTML. */
export function parseRtPageScores(html: string): RtPageScores {
  const ld = parseLdJson(html);
  const card = parseMediaScorecard(html);

  const tomatometer = card?.tomatometer ?? ld.score;
  const audienceScore = card?.audienceScore ?? null;
  const state = card
    ? stateFromScore(tomatometer, card.certified, card.sentiment)
    : tomatometer != null
      ? tomatometer >= 75
        ? "certified-fresh"
        : tomatometer >= 60
          ? "fresh"
          : "rotten"
      : null;

  return {
    tomatometer,
    audienceScore,
    state,
    name: ld.name,
    type: ld.type,
  };
}

/**
 * Fetch an RT title page. Returns null on 404 / block / network failure.
 * `no-store`: callers do their own caching in the DB.
 */
export async function fetchRtPageHtml(
  prefix: RtPagePrefix,
  slug: string
): Promise<string | null> {
  try {
    const res = await fetch(`https://www.rottentomatoes.com/${prefix}/${slug}`, {
      headers: {
        "User-Agent": RT_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      cache: "no-store",
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (
      html.includes("404 - Not Found") ||
      html.includes("Sorry, please try again later")
    ) {
      return null;
    }
    return html;
  } catch {
    return null;
  }
}
