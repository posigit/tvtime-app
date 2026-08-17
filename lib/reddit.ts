/**
 * Reddit discussion search.
 *
 * Order: official OAuth (if REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET), then
 * Arctic Shift. PullPush 429s automated clients; reddit.com JSON 403s from
 * cloud IPs. Huge subs (movies/television) time out on Arctic without a
 * date bound, so those are searched last with after=2010.
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

const ARCTIC_SEARCH = "https://arctic-shift.photon-reddit.com/api/posts/search";
const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const REDDIT_OAUTH = "https://oauth.reddit.com";

const SEARCH_CACHE_OK_MS = 30 * 60 * 1000;
const SEARCH_CACHE_FAIL_MS = 2 * 60 * 1000;
const LARGE_SUBS = new Set(["movies", "television"]);

const searchCache = new Map<
  string,
  { hits: RedditSubmission[]; expiresAt: number }
>();

let oauthToken: { value: string; expiresAt: number } | null = null;

function redditUserAgent() {
  return (
    process.env.REDDIT_USER_AGENT?.trim() ||
    "web:tvtime-app:v1.1 (personal media tracker)"
  );
}

function jsonHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Accept: "application/json",
    "User-Agent": redditUserAgent(),
    ...extra,
  };
}

export function normalizeRow(
  row: Record<string, unknown>,
  fallbackSub: string
): RedditSubmission | null {
  const id = String(row.id ?? row.name ?? "").replace(/^t3_/, "");
  if (!id) return null;
  if (row.stickied || row.over_18) return null;

  const title = String(row.title ?? "").trim();
  if (!title) return null;

  let permalink = String(row.permalink ?? "");
  if (permalink && !permalink.startsWith("http")) {
    permalink = `https://www.reddit.com${permalink}`;
  }
  if (!permalink) {
    const url = typeof row.url === "string" ? row.url : "";
    permalink = url.includes("reddit.com")
      ? url
      : `https://www.reddit.com/r/${row.subreddit ?? fallbackSub}/comments/${id}/`;
  }

  const created =
    typeof row.created_utc === "number"
      ? row.created_utc
      : typeof row.created_utc === "string" && /^\d+$/.test(row.created_utc)
        ? Number(row.created_utc)
        : null;

  return {
    id,
    author:
      row.author && String(row.author) !== "[deleted]"
        ? String(row.author)
        : "redditor",
    title,
    selftext: String(row.selftext ?? "").trim(),
    permalink,
    created_utc: created,
    subreddit: String(row.subreddit ?? fallbackSub),
    score: typeof row.score === "number" ? row.score : 0,
    num_comments: typeof row.num_comments === "number" ? row.num_comments : 0,
  };
}

/** Arctic `{data: Row[]}` or official `{data:{children:[{data}]}}`. */
export function listingRows(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const root = json as Record<string, unknown>;
  if (Array.isArray(root.data)) {
    return root.data.filter(
      (r): r is Record<string, unknown> => !!r && typeof r === "object"
    );
  }
  const inner = root.data;
  if (inner && typeof inner === "object") {
    const children = (inner as { children?: unknown }).children;
    if (Array.isArray(children)) {
      return children
        .map((c) =>
          c && typeof c === "object"
            ? ((c as { data?: unknown }).data ?? null)
            : null
        )
        .filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
    }
  }
  return [];
}

function cacheGet(key: string): RedditSubmission[] | null {
  const hit = searchCache.get(key);
  if (!hit || hit.expiresAt <= Date.now()) return null;
  return hit.hits;
}

function cacheSet(key: string, hits: RedditSubmission[], ttl: number) {
  searchCache.set(key, { hits, expiresAt: Date.now() + ttl });
}

async function getOauthToken(): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID?.trim();
  const secret = process.env.REDDIT_CLIENT_SECRET?.trim();
  if (!id || !secret) return null;
  if (oauthToken && oauthToken.expiresAt > Date.now() + 30_000) {
    return oauthToken.value;
  }

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  try {
    const res = await fetch(REDDIT_TOKEN_URL, {
      method: "POST",
      headers: {
        ...jsonHeaders({
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      console.error(`Reddit OAuth token ${res.status}`);
      return null;
    }
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!json.access_token) return null;
    oauthToken = {
      value: json.access_token,
      expiresAt: Date.now() + Math.max(60, json.expires_in ?? 3600) * 1000,
    };
    return oauthToken.value;
  } catch (err) {
    console.error(
      "Reddit OAuth token:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

async function searchOfficial(
  title: string,
  subreddits: string[],
  limit: number
): Promise<RedditSubmission[] | null> {
  const token = await getOauthToken();
  if (!token) return null;

  const joined = subreddits.join("+");
  const url = new URL(`${REDDIT_OAUTH}/r/${joined}/search`);
  url.searchParams.set("q", title);
  url.searchParams.set("restrict_sr", "1");
  url.searchParams.set("sort", "top");
  url.searchParams.set("t", "all");
  url.searchParams.set("limit", String(Math.min(limit, 25)));
  url.searchParams.set("type", "link");
  url.searchParams.set("raw_json", "1");

  try {
    const res = await fetch(url.toString(), {
      headers: jsonHeaders({ Authorization: `Bearer ${token}` }),
      signal: AbortSignal.timeout(6_000),
      next: { revalidate: 1800 },
    });
    if (!res.ok) {
      console.error(`Reddit OAuth search ${res.status}`);
      return [];
    }
    const rows = listingRows(await res.json());
    return rows
      .map((r) => normalizeRow(r, subreddits[0] ?? "movies"))
      .filter((x): x is RedditSubmission => x != null);
  } catch (err) {
    console.error(
      "Reddit OAuth search:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

async function searchArctic(
  title: string,
  subreddit: string,
  limit: number
): Promise<RedditSubmission[]> {
  const cacheKey = `arctic|${title.toLowerCase()}|${subreddit}|${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = new URL(ARCTIC_SEARCH);
  url.searchParams.set("subreddit", subreddit);
  url.searchParams.set("title", title);
  url.searchParams.set("limit", String(Math.min(limit, 25)));
  url.searchParams.set("sort", "desc");
  url.searchParams.set("over_18", "false");
  url.searchParams.set(
    "fields",
    "id,title,selftext,url,created_utc,subreddit,score,num_comments,author,over_18"
  );
  if (LARGE_SUBS.has(subreddit.toLowerCase())) {
    url.searchParams.set("after", "2010-01-01");
  }

  try {
    const res = await fetch(url.toString(), {
      headers: jsonHeaders(),
      signal: AbortSignal.timeout(10_000),
      next: { revalidate: 1800 },
    });
    if (!res.ok) {
      cacheSet(cacheKey, [], SEARCH_CACHE_FAIL_MS);
      console.error(`Arctic Shift ${subreddit} ${res.status}`);
      return [];
    }
    const rows = listingRows(await res.json());
    const hits = rows
      .map((r) => normalizeRow(r, subreddit))
      .filter((x): x is RedditSubmission => x != null);
    cacheSet(cacheKey, hits, SEARCH_CACHE_OK_MS);
    return hits;
  } catch (err) {
    cacheSet(cacheKey, [], SEARCH_CACHE_FAIL_MS);
    console.error(
      `Arctic Shift ${subreddit}:`,
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
  return hits >= Math.min(tokens.length, Math.max(1, tokens.length - 1));
}

function dedupe(items: RedditSubmission[]): RedditSubmission[] {
  const seen = new Set<string>();
  const out: RedditSubmission[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

function rankHits(
  batches: RedditSubmission[][],
  title: string
): RedditSubmission[] {
  let hits = dedupe(batches.flat());
  const relevant = hits.filter((h) => isRelevant(h, title));
  hits = relevant.length >= 3 ? relevant : relevant;

  if (hits.length === 0) {
    hits = dedupe(batches.flat()).filter((h) => {
      const tokens = titleTokens(title);
      const hay = `${h.title} ${h.selftext}`.toLowerCase();
      return tokens.some((t) => hay.includes(t));
    });
  }

  hits = hits.filter(
    (h) => h.selftext.length >= 80 || h.num_comments >= 8 || h.score >= 25
  );

  hits.sort(
    (a, b) =>
      b.score + b.num_comments * 3 - (a.score + a.num_comments * 3)
  );
  return hits;
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
  const limit = opts.limit ?? 15;

  // One small discussion sub — r/movies and r/television time out on Arctic,
  // and two parallel searches 422 the free archive.
  const primary = opts.kind === "movie" ? "MovieSuggestions" : "televisionsuggestions";
  const oauthSubs =
    opts.kind === "movie"
      ? ["movies", "MovieSuggestions", "TrueFilm"]
      : ["television", "televisionsuggestions", "series"];

  const cacheKey = `all|${opts.kind}|${title.toLowerCase()}|${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached.slice(0, limit);

  const official = await searchOfficial(title, oauthSubs, 25);
  if (official && official.length > 0) {
    const ranked = rankHits([official], title).slice(0, limit);
    cacheSet(cacheKey, ranked, SEARCH_CACHE_OK_MS);
    return ranked;
  }

  const batches = [await searchArctic(title, primary, 15)];

  const ranked = rankHits(batches, title).slice(0, limit);
  cacheSet(
    cacheKey,
    ranked,
    ranked.length > 0 ? SEARCH_CACHE_OK_MS : SEARCH_CACHE_FAIL_MS
  );
  return ranked;
}

export function redditSearchUrl(title: string, kind: "movie" | "tv") {
  const sub = kind === "movie" ? "movies" : "television";
  return `https://www.reddit.com/r/${sub}/search/?q=${encodeURIComponent(title)}&restrict_sr=1&sort=top&t=all`;
}
