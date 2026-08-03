/**
 * Community reviews from TMDB + Reddit discussion threads.
 * Server-only fetchers; shape is serializable for client UI.
 */

import { getMovieReviews, getTvReviews, type TmdbReview } from "./tmdb";
import { redditSearchUrl, searchRedditDiscussions } from "./reddit";

export type ReviewSource = "tmdb" | "reddit";

export type CommunityReview = {
  id: string;
  source: ReviewSource;
  author: string;
  /** TMDB author rating 1–10 when present */
  rating: number | null;
  /** Reddit post title (or empty for TMDB) */
  title: string | null;
  content: string;
  url: string | null;
  createdAt: string | null;
  /** e.g. r/movies */
  subreddit: string | null;
  /** Reddit upvotes */
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

function cleanText(raw: string, max = 1200): string {
  const t = raw
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (t.length <= max) return t;
  return t.slice(0, max).trimEnd() + "…";
}

function mapTmdb(r: TmdbReview): CommunityReview | null {
  const content = cleanText(r.content || "");
  if (!content) return null;
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

type RedditChild = {
  data?: {
    id?: string;
    name?: string;
    author?: string;
    title?: string;
    selftext?: string;
    url?: string;
    permalink?: string;
    created_utc?: number;
    subreddit?: string;
    score?: number;
    num_comments?: number;
    stickied?: boolean;
    over_18?: boolean;
  };
};

function mapReddit(child: RedditChild): CommunityReview | null {
  const d = child.data;
  if (!d?.id || d.stickied || d.over_18) return null;

  const title = (d.title || "").trim();
  const body = cleanText(d.selftext || "", 900);
  if (!title) return null;
  if (!body && (d.num_comments ?? 0) < 15 && (d.score ?? 0) < 50) return null;

  const content = body || "Open the thread for the full discussion.";
  const permalink = d.permalink
    ? `https://www.reddit.com${d.permalink}`
    : d.url || null;

  return {
    id: `reddit-${d.name || d.id}`,
    source: "reddit",
    author: d.author && d.author !== "[deleted]" ? d.author : "redditor",
    rating: null,
    title,
    content,
    url: permalink,
    createdAt:
      typeof d.created_utc === "number"
        ? new Date(d.created_utc * 1000).toISOString()
        : null,
    subreddit: d.subreddit ? `r/${d.subreddit}` : null,
    score: typeof d.score === "number" ? d.score : null,
    commentCount: typeof d.num_comments === "number" ? d.num_comments : null,
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
      .slice(0, 12);
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
  const cleanTitle = title.trim();
  if (!cleanTitle) return [];

  const subreddits =
    kind === "movie"
      ? "movies+TrueFilm+MovieSuggestions+flicks"
      : "television+TrueFilm+televisionsuggestions+series";

  const q = [
    `"${cleanTitle}"`,
    year ? year.slice(0, 4) : null,
    "(review OR discussion OR thoughts OR spoiler)",
  ]
    .filter(Boolean)
    .join(" ");

  try {
    const data = await searchRedditDiscussions({
      query: q,
      subreddits,
      limit: 15,
    });
    const children = data?.children ?? [];
    const mapped = children
      .map(mapReddit)
      .filter((r): r is CommunityReview => r != null);

    mapped.sort((a, b) => {
      const sa = (a.score ?? 0) + (a.commentCount ?? 0) * 2;
      const sb = (b.score ?? 0) + (b.commentCount ?? 0) * 2;
      return sb - sa;
    });

    return mapped.slice(0, 8);
  } catch (err) {
    console.error(
      "Reddit reviews failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/** Synthetic card so Reddit is still one click away when API is blocked. */
function redditBrowseCard(
  title: string,
  kind: "movie" | "tv"
): CommunityReview {
  return {
    id: "reddit-browse",
    source: "reddit",
    author: "Reddit",
    rating: null,
    title: `Discuss ${title} on Reddit`,
    content:
      "Jump into community threads on r/movies, r/television, and TrueFilm. Live posts appear here when Reddit search is available for this app.",
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

  const out: CommunityReview[] = [];
  const max = Math.max(tmdb.length, redditList.length);
  for (let i = 0; i < max; i++) {
    if (tmdb[i]) out.push(tmdb[i]);
    if (redditList[i]) out.push(redditList[i]);
  }
  return out;
}
