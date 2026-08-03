/**
 * Community reviews from TMDB + Reddit.
 * Server-only fetchers; serializable for client UI.
 */

import { getMovieReviews, getTvReviews, type TmdbReview } from "./tmdb";
import {
  redditSearchUrl,
  searchRedditDiscussions,
  type RedditSubmission,
} from "./reddit";

export type ReviewSource = "tmdb" | "reddit";

export type CommunityReview = {
  id: string;
  source: ReviewSource;
  author: string;
  rating: number | null;
  title: string | null;
  content: string;
  url: string | null;
  createdAt: string | null;
  subreddit: string | null;
  score: number | null;
  commentCount: number | null;
  avatarUrl: string | null;
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
    title: null,
    content,
    url: r.url ?? null,
    createdAt: r.created_at ?? r.updated_at ?? null,
    subreddit: null,
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
    title: d.title,
    content: body || "Open the thread for the full discussion.",
    url: d.permalink || null,
    createdAt:
      d.created_utc != null
        ? new Date(d.created_utc * 1000).toISOString()
        : null,
    subreddit: d.subreddit ? `r/${d.subreddit}` : null,
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
    const data =
      kind === "movie"
        ? await getMovieReviews(tmdbId)
        : await getTvReviews(tmdbId);
    return (data.results ?? [])
      .map(mapTmdb)
      .filter((r): r is CommunityReview => r != null)
      .slice(0, 15);
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
      limit: 10,
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
    title: `Search Reddit for “${title}”`,
    content:
      "No embedded threads found. Open Reddit for live discussion on this title.",
    url: redditSearchUrl(title, kind),
    createdAt: null,
    subreddit: kind === "movie" ? "r/movies" : "r/television",
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
}): Promise<CommunityReview[]> {
  const [tmdb, reddit] = await Promise.all([
    fetchTmdbReviews(opts.kind, opts.tmdbId),
    fetchRedditReviews(opts.kind, opts.title, opts.year),
  ]);

  const redditList =
    reddit.length > 0 ? reddit : [redditBrowseCard(opts.title, opts.kind)];

  // TMDB first (actual reviews), then Reddit discussions
  return [...tmdb, ...redditList];
}
