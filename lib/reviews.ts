/**
 * Community reviews: Rotten Tomatoes critics + TMDB fans + Reddit threads.
 */

import { getMovieReviews, getTvReviews, type TmdbReview } from "./tmdb";
import {
  redditSearchUrl,
  searchRedditDiscussions,
  type RedditSubmission,
} from "./reddit";
import { getRtReviewBundle } from "./rt-reviews";

export type ReviewSource = "rt" | "tmdb" | "reddit";
export type ReviewSentiment = "fresh" | "rotten" | null;

export type CommunityReview = {
  id: string;
  source: ReviewSource;
  author: string;
  /** TMDB 1–10; RT uses sentiment instead */
  rating: number | null;
  sentiment: ReviewSentiment;
  title: string | null;
  content: string;
  url: string | null;
  createdAt: string | null;
  /** RT publication or Reddit subreddit */
  meta: string | null;
  score: number | null;
  commentCount: number | null;
  avatarUrl: string | null;
  /** Highlighted RT consensus card */
  featured?: boolean;
};

export type ReviewsPayload = {
  reviews: CommunityReview[];
  rtScore: number | null;
  rtState: string | null;
  rtUrl: string | null;
  counts: { all: number; rt: number; tmdb: number; reddit: number; fresh: number; rotten: number };
};

const TMDB_IMG = "https://image.tmdb.org/t/p/w45";

function tmdbAvatar(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("/http")) return path.slice(1);
  if (path.startsWith("http")) return path;
  return `${TMDB_IMG}${path}`;
}

function cleanText(raw: string, max = 1400): string {
  const t = raw
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (t.length <= max) return t;
  return t.slice(0, max).trimEnd() + "…";
}

function sentimentFromTen(rating: number | null): ReviewSentiment {
  if (rating == null) return null;
  return rating >= 6 ? "fresh" : "rotten";
}

function mapTmdb(r: TmdbReview): CommunityReview | null {
  const content = cleanText(r.content || "");
  if (content.length < 20) return null;
  const author =
    r.author_details?.name?.trim() ||
    r.author_details?.username?.trim() ||
    r.author?.trim() ||
    "TMDB user";
  const rating =
    typeof r.author_details?.rating === "number" && r.author_details.rating > 0
      ? r.author_details.rating
      : null;

  return {
    id: `tmdb-${r.id}`,
    source: "tmdb",
    author,
    rating,
    sentiment: sentimentFromTen(rating),
    title: null,
    content,
    url: r.url ?? null,
    createdAt: r.created_at ?? r.updated_at ?? null,
    meta: "TMDB",
    score: null,
    commentCount: null,
    avatarUrl: tmdbAvatar(r.author_details?.avatar_path),
  };
}

function mapReddit(d: RedditSubmission): CommunityReview {
  const body = cleanText(d.selftext, 900);
  return {
    id: `reddit-${d.id}`,
    source: "reddit",
    author: d.author,
    rating: null,
    sentiment: null,
    title: d.title,
    content: body || "Open the thread for the full discussion.",
    url: d.permalink || null,
    createdAt:
      d.created_utc != null
        ? new Date(d.created_utc * 1000).toISOString()
        : null,
    meta: d.subreddit ? `r/${d.subreddit}` : "Reddit",
    score: d.score,
    commentCount: d.num_comments,
    avatarUrl: null,
  };
}

async function fetchTmdbReviews(
  kind: "movie" | "tv",
  tmdbId: number
): Promise<CommunityReview[]> {
  try {
    // Pull more pages when available
    const pages = await Promise.all([
      kind === "movie" ? getMovieReviews(tmdbId, 1) : getTvReviews(tmdbId, 1),
      kind === "movie" ? getMovieReviews(tmdbId, 2) : getTvReviews(tmdbId, 2),
    ]);
    const seen = new Set<string>();
    const out: CommunityReview[] = [];
    for (const data of pages) {
      for (const r of data.results ?? []) {
        const mapped = mapTmdb(r);
        if (!mapped || seen.has(mapped.id)) continue;
        seen.add(mapped.id);
        out.push(mapped);
      }
    }
    return out.slice(0, 25);
  } catch (err) {
    console.error(
      "TMDB reviews failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

async function fetchRedditReviews(
  kind: "movie" | "tv",
  title: string,
  year?: string | null
): Promise<CommunityReview[]> {
  try {
    const posts = await searchRedditDiscussions({
      title,
      kind,
      year,
      limit: 15,
    });
    return posts.map(mapReddit);
  } catch (err) {
    console.error(
      "Reddit reviews failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

function redditBrowseCard(
  title: string,
  kind: "movie" | "tv"
): CommunityReview {
  return {
    id: "reddit-browse",
    source: "reddit",
    author: "Reddit",
    rating: null,
    sentiment: null,
    title: `Browse discussions about “${title}”`,
    content: "Jump to Reddit for live threads on this title.",
    url: redditSearchUrl(title, kind),
    createdAt: null,
    meta: kind === "movie" ? "r/movies" : "r/television",
    score: null,
    commentCount: null,
    avatarUrl: null,
  };
}

export async function getCommunityReviews(opts: {
  kind: "movie" | "tv";
  tmdbId: number;
  title: string;
  year?: string | null;
  /** Prefer DB score when scrape misses */
  knownRtScore?: number | null;
}): Promise<ReviewsPayload> {
  const [tmdb, reddit, rt] = await Promise.all([
    fetchTmdbReviews(opts.kind, opts.tmdbId),
    fetchRedditReviews(opts.kind, opts.title, opts.year),
    getRtReviewBundle({
      kind: opts.kind,
      title: opts.title,
      year: opts.year,
    }).catch(() => ({
      score: null,
      state: null,
      consensus: null,
      pageUrl: null,
      reviews: [],
    })),
  ]);

  const rtReviews: CommunityReview[] = [];

  if (rt.consensus) {
    const s =
      (rt.score ?? opts.knownRtScore ?? null) != null &&
      (rt.score ?? opts.knownRtScore)! >= 60
        ? "fresh"
        : (rt.score ?? opts.knownRtScore) != null
          ? "rotten"
          : "fresh";
    rtReviews.push({
      id: "rt-consensus",
      source: "rt",
      author: "Critics Consensus",
      rating: null,
      sentiment: s,
      title: "Rotten Tomatoes",
      content: rt.consensus,
      url: rt.pageUrl,
      createdAt: null,
      meta: rt.score != null ? `${rt.score}% Tomatometer` : "Rotten Tomatoes",
      score: rt.score,
      commentCount: null,
      avatarUrl: null,
      featured: true,
    });
  }

  for (const [i, r] of rt.reviews.entries()) {
    rtReviews.push({
      id: `rt-${i}-${r.author}`,
      source: "rt",
      author: r.author,
      rating: null,
      sentiment: r.sentiment,
      title: null,
      content: r.content,
      url: r.url || rt.pageUrl,
      createdAt: r.date,
      meta: r.publication,
      score: null,
      commentCount: null,
      avatarUrl: null,
    });
  }

  const redditList =
    reddit.length > 0 ? reddit : [redditBrowseCard(opts.title, opts.kind)];

  // Order: RT consensus + critics, then TMDB, then Reddit
  const reviews = [...rtReviews, ...tmdb, ...redditList];

  const counts = {
    all: reviews.length,
    rt: rtReviews.length,
    tmdb: tmdb.length,
    reddit: redditList.filter((r) => r.id !== "reddit-browse").length || (redditList.length ? 1 : 0),
    fresh: reviews.filter((r) => r.sentiment === "fresh").length,
    rotten: reviews.filter((r) => r.sentiment === "rotten").length,
  };

  return {
    reviews,
    rtScore:
      rt.score ??
      (opts.knownRtScore != null && opts.knownRtScore >= 0
        ? opts.knownRtScore
        : null),
    rtState: rt.state,
    rtUrl: rt.pageUrl,
    counts,
  };
}
