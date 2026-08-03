/**
 * Rotten Tomatoes critic consensus + review quotes from public HTML.
 * No private API (returns 401). Scrapes SSR markup that already works for scores.
 */

import { titleToRtSlug } from "./rt-tv";

const RT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export type RtSentiment = "fresh" | "rotten";

export type RtCriticReview = {
  author: string;
  publication: string | null;
  content: string;
  sentiment: RtSentiment;
  date: string | null;
  url: string | null;
};

export type RtReviewBundle = {
  score: number | null;
  /** certified-fresh | fresh | rotten | null */
  state: string | null;
  consensus: string | null;
  pageUrl: string | null;
  reviews: RtCriticReview[];
};

function decodeHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(s: string): string {
  return decodeHtml(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function candidateSlugs(title: string, year?: string | null): string[] {
  const base = titleToRtSlug(title);
  if (!base) return [];
  const out: string[] = [];
  const push = (s: string) => {
    if (s && !out.includes(s)) out.push(s);
  };
  if (year && /^\d{4}$/.test(year)) {
    push(`${base}_${year}`);
  }
  push(base);
  if (base.startsWith("the_")) push(base.slice(4));
  return out;
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": RT_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      next: { revalidate: 3600 },
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

function parseScore(html: string): {
  score: number | null;
  state: string | null;
} {
  // Prefer ld+json aggregateRating
  const ld = html.match(
    /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/i
  );
  if (ld) {
    try {
      const data = JSON.parse(ld[1]) as {
        aggregateRating?: { ratingValue?: string | number; name?: string };
      };
      const raw = data.aggregateRating?.ratingValue;
      if (raw != null && raw !== "") {
        const score =
          typeof raw === "number"
            ? raw
            : Number(String(raw).match(/\d+/)?.[0]);
        if (Number.isFinite(score) && score >= 0 && score <= 100) {
          const rounded = Math.round(score);
          const state =
            rounded >= 75
              ? "certified-fresh"
              : rounded >= 60
                ? "fresh"
                : "rotten";
          return { score: rounded, state };
        }
      }
    } catch {
      /* fall through */
    }
  }

  const m = html.match(
    /score-icon-critics[^>]*sentiment="([^"]+)"[\s\S]{0,200}?class="critics-score"[^>]*>(\d+)%/i
  );
  if (m) {
    const score = Number(m[2]);
    const sent = m[1].toLowerCase();
    const state =
      score >= 75
        ? "certified-fresh"
        : sent.includes("neg") || score < 60
          ? "rotten"
          : "fresh";
    return { score, state };
  }
  return { score: null, state: null };
}

function parseConsensus(html: string): string | null {
  const m = html.match(/class="consensus"[\s\S]*?<p>([\s\S]*?)<\/p>/i);
  if (!m) return null;
  const text = stripTags(m[1]);
  return text.length > 20 ? text : null;
}

function parseCriticCards(html: string): RtCriticReview[] {
  const blocks = [
    ...html.matchAll(/<review-card-critic[\s\S]*?<\/review-card-critic>/gi),
  ];
  const out: RtCriticReview[] = [];

  for (const block of blocks) {
    const h = block[0];
    const sentimentRaw = h.match(/sentiment="([^"]+)"/i)?.[1]?.toUpperCase();
    const sentiment: RtSentiment =
      sentimentRaw === "NEGATIVE" ? "rotten" : "fresh";

    const name =
      stripTags(
        h.match(
          /slot="name"[^>]*>([\s\S]*?)<\/rt-link>/i
        )?.[1] ?? ""
      ) || "Critic";

    const publication =
      stripTags(
        h.match(
          /slot="publication"[^>]*>([\s\S]*?)<\/rt-link>/i
        )?.[1] ?? ""
      ) || null;

    const content = stripTags(
      h.match(/slot="review"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ""
    );
    if (content.length < 12) continue;

    const date =
      stripTags(
        h.match(/slot="timestamp"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ""
      ) || null;

    const link =
      h.match(/slot="review-link"[^>]*href="([^"]+)"/i)?.[1] || null;

    out.push({
      author: name,
      publication,
      content,
      sentiment,
      date,
      url: link,
    });
  }

  return out;
}

/**
 * Fetch RT score, critics consensus, and featured critic quotes.
 */
export async function getRtReviewBundle(opts: {
  kind: "movie" | "tv";
  title: string;
  year?: string | null;
}): Promise<RtReviewBundle> {
  const empty: RtReviewBundle = {
    score: null,
    state: null,
    consensus: null,
    pageUrl: null,
    reviews: [],
  };

  const title = opts.title?.trim();
  if (!title) return empty;

  const year = opts.year?.slice(0, 4) ?? null;
  const slugs = candidateSlugs(title, year);
  const prefix = opts.kind === "movie" ? "m" : "tv";

  for (const slug of slugs) {
    const pageUrl = `https://www.rottentomatoes.com/${prefix}/${slug}`;
    const html = await fetchHtml(pageUrl);
    if (!html) continue;

    const { score, state } = parseScore(html);
    const consensus = parseConsensus(html);
    const reviews = parseCriticCards(html);

    // Accept page if we got anything useful
    if (score != null || consensus || reviews.length > 0) {
      return {
        score,
        state: state ?? (score != null && score >= 60 ? "fresh" : score != null ? "rotten" : null),
        consensus,
        pageUrl,
        reviews: reviews.slice(0, 20),
      };
    }
  }

  return empty;
}
