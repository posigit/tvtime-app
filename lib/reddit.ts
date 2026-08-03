/**
 * Reddit discussion search via PullPush (reliable from cloud hosts).
 * Falls back to official OAuth / public JSON when configured.
 */

export type RedditSubmission = {
  id: string;
  author: string;
  title: string;
  selftext: string;
  permalink: string;
  created_utc: number | null;
  subreddit: string;
  score: number;
  num_comments: number;
};

function redditUserAgent() {
  return (
    process.env.REDDIT_USER_AGENT?.trim() ||
    "web:tvtime-app:v1.1 (personal media tracker)"
  );
}

function normalizeRow(row: Record<string, unknown>, fallbackSub: string): RedditSubmission | null {
  const id = String(row.id ?? row.name ?? "");
  if (!id) return null;
  if (row.stickied || row.over_18) return null;

  const title = String(row.title ?? "").trim();
  if (!title) return null;

  let permalink = String(row.permalink ?? "");
  if (permalink && !permalink.startsWith("http")) {
    permalink = `https://www.reddit.com${permalink}`;
  }
  if (!permalink && row.url) permalink = String(row.url);

  return {
    id,
    author:
      row.author && String(row.author) !== "[deleted]"
        ? String(row.author)
        : "redditor",
    title,
    selftext: String(row.selftext ?? "").trim(),
    permalink,
    created_utc:
      typeof row.created_utc === "number" ? row.created_utc : null,
    subreddit: String(row.subreddit ?? fallbackSub),
    score: typeof row.score === "number" ? row.score : 0,
    num_comments: typeof row.num_comments === "number" ? row.num_comments : 0,
  };
}

/** PullPush title search — most reliable path from Vercel/etc. */
async function searchPullPushByTitle(
  title: string,
  subreddit: string,
  size = 50
): Promise<RedditSubmission[]> {
  try {
    const url = new URL("https://api.pullpush.io/reddit/search/submission/");
    // `title=` matches post titles; plain `q=` is full-text noise
    url.searchParams.set("title", title);
    url.searchParams.set("subreddit", subreddit);
    url.searchParams.set("size", String(size));
    url.searchParams.set("sort", "desc");
    url.searchParams.set("sort_type", "score");

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": redditUserAgent(),
      },
      next: { revalidate: 1800 },
    });
    if (!res.ok) {
      console.error(`PullPush ${subreddit} ${res.status}`);
      return [];
    }

    const json = (await res.json()) as { data?: Record<string, unknown>[] };
    const rows = json.data ?? [];
    return rows
      .map((r) => normalizeRow(r, subreddit))
      .filter((x): x is RedditSubmission => x != null);
  } catch (err) {
    console.error(
      `PullPush ${subreddit}:`,
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !/^(the|and|of|a|an|for|with)$/.test(t));
}

function isRelevant(post: RedditSubmission, mediaTitle: string): boolean {
  const hay = post.title.toLowerCase();
  const full = mediaTitle.toLowerCase();
  if (hay.includes(full)) return true;
  const tokens = titleTokens(mediaTitle);
  if (tokens.length === 0) return true;
  const hits = tokens.filter((t) => hay.includes(t)).length;
  // Need most distinctive words in the post title
  return hits >= Math.min(tokens.length, Math.max(1, tokens.length - 1));
}

function dedupe(items: RedditSubmission[]): RedditSubmission[] {
  const seen = new Set<string>();
  const out: RedditSubmission[] = [];
  for (const it of items) {
    const key = it.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/**
 * Find Reddit threads about a title.
 */
export async function searchRedditDiscussions(opts: {
  title: string;
  kind: "movie" | "tv";
  year?: string | null;
  limit?: number;
}): Promise<RedditSubmission[]> {
  const title = opts.title.trim();
  if (!title) return [];

  const subs =
    opts.kind === "movie"
      ? ["movies", "TrueFilm", "MovieSuggestions", "criterion"]
      : ["television", "TrueFilm", "televisionsuggestions", "series"];

  const batches = await Promise.all(
    subs.map((sub) => searchPullPushByTitle(title, sub, 40))
  );
  let hits = dedupe(batches.flat());

  // Prefer posts whose *title* is actually about this media
  const relevant = hits.filter((h) => isRelevant(h, title));
  hits = relevant.length >= 3 ? relevant : hits.filter((h) => isRelevant(h, title) || (h.score >= 50 && isRelevant(h, title)));
  // If still empty, keep score-sorted posts that mention at least one token
  if (hits.length === 0) {
    hits = dedupe(batches.flat()).filter((h) => {
      const tokens = titleTokens(title);
      const hay = `${h.title} ${h.selftext}`.toLowerCase();
      return tokens.some((t) => hay.includes(t));
    });
  }

  // Prefer engaged threads; allow short selftext if comments/score exist
  hits = hits.filter(
    (h) =>
      h.selftext.length >= 80 ||
      h.num_comments >= 8 ||
      h.score >= 25
  );

  hits.sort(
    (a, b) =>
      b.score + b.num_comments * 3 - (a.score + a.num_comments * 3)
  );

  return hits.slice(0, opts.limit ?? 15);
}

export function redditSearchUrl(title: string, kind: "movie" | "tv") {
  const sub = kind === "movie" ? "movies" : "television";
  return `https://www.reddit.com/r/${sub}/search/?q=${encodeURIComponent(title)}&restrict_sr=1&sort=top&t=all`;
}
