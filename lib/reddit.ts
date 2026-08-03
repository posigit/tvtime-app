/**
 * Reddit discussion search.
 *
 * Strategy (in order):
 * 1. PullPush free search API (works from cloud — no OAuth)
 * 2. Official OAuth if REDDIT_CLIENT_ID/SECRET set
 * 3. Public www.reddit.com JSON (often blocked on hosts)
 *
 * Always fails soft → empty list.
 */

export type RedditSubmission = {
  id: string;
  name?: string;
  author: string;
  title: string;
  selftext: string;
  permalink: string;
  created_utc: number | null;
  subreddit: string;
  score: number;
  num_comments: number;
};

type RedditListingChild = {
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

let cachedToken: { value: string; exp: number } | null = null;

function redditUserAgent() {
  return (
    process.env.REDDIT_USER_AGENT?.trim() ||
    "web:tvtime-app:v1.0 (by /u/tvtime_app_user)"
  );
}

function normalizeChild(child: RedditListingChild): RedditSubmission | null {
  const d = child.data;
  if (!d?.id || d.stickied || d.over_18) return null;
  const title = (d.title || "").trim();
  if (!title) return null;

  const permalink = d.permalink
    ? d.permalink.startsWith("http")
      ? d.permalink
      : `https://www.reddit.com${d.permalink}`
    : d.url || "";

  return {
    id: d.name || d.id,
    name: d.name,
    author: d.author && d.author !== "[deleted]" ? d.author : "redditor",
    title,
    selftext: (d.selftext || "").trim(),
    permalink,
    created_utc: typeof d.created_utc === "number" ? d.created_utc : null,
    subreddit: d.subreddit || "",
    score: typeof d.score === "number" ? d.score : 0,
    num_comments: typeof d.num_comments === "number" ? d.num_comments : 0,
  };
}

/** PullPush — third-party Reddit search that works from most hosts. */
async function searchPullPush(
  query: string,
  subreddits: string[],
  size = 12
): Promise<RedditSubmission[]> {
  const out: RedditSubmission[] = [];

  await Promise.all(
    subreddits.map(async (sub) => {
      try {
        const url = new URL("https://api.pullpush.io/reddit/search/submission/");
        url.searchParams.set("q", query);
        url.searchParams.set("subreddit", sub);
        url.searchParams.set("size", String(size));
        url.searchParams.set("sort", "desc");
        url.searchParams.set("sort_type", "score");

        const res = await fetch(url.toString(), {
          headers: {
            Accept: "application/json",
            "User-Agent": redditUserAgent(),
          },
          next: { revalidate: 3600 },
        });
        if (!res.ok) return;

        const json = (await res.json()) as {
          data?: Array<Record<string, unknown>>;
        };
        const rows = json.data ?? [];
        for (const row of rows) {
          const mapped = normalizeChild({
            data: {
              id: String(row.id ?? row._id ?? ""),
              name: row.name ? String(row.name) : undefined,
              author: row.author ? String(row.author) : undefined,
              title: row.title ? String(row.title) : undefined,
              selftext: row.selftext ? String(row.selftext) : "",
              permalink: row.permalink ? String(row.permalink) : undefined,
              url: row.url ? String(row.url) : undefined,
              created_utc:
                typeof row.created_utc === "number" ? row.created_utc : undefined,
              subreddit: row.subreddit ? String(row.subreddit) : sub,
              score: typeof row.score === "number" ? row.score : 0,
              num_comments:
                typeof row.num_comments === "number" ? row.num_comments : 0,
              stickied: Boolean(row.stickied),
              over_18: Boolean(row.over_18),
            },
          });
          if (mapped) out.push(mapped);
        }
      } catch (err) {
        console.error(
          `PullPush ${sub}:`,
          err instanceof Error ? err.message : err
        );
      }
    })
  );

  return out;
}

async function getOAuthToken(): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID?.trim();
  const secret = process.env.REDDIT_CLIENT_SECRET?.trim();
  if (!id || !secret) return null;

  if (cachedToken && Date.now() < cachedToken.exp - 60_000) {
    return cachedToken.value;
  }

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": redditUserAgent(),
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!res.ok) {
    console.error(`Reddit OAuth ${res.status}`);
    return null;
  }

  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) return null;

  cachedToken = {
    value: json.access_token,
    exp: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

async function searchOfficial(
  query: string,
  subredditsJoined: string,
  limit: number
): Promise<RedditSubmission[]> {
  const token = await getOAuthToken().catch(() => null);

  const parseListing = async (res: Response) => {
    if (!res.ok) return [] as RedditSubmission[];
    const text = await res.text();
    if (text.trimStart().startsWith("<")) return [];
    try {
      const json = JSON.parse(text) as { data?: { children?: RedditListingChild[] } };
      return (json.data?.children ?? [])
        .map(normalizeChild)
        .filter((x): x is RedditSubmission => x != null);
    } catch {
      return [];
    }
  };

  if (token) {
    const url = new URL(
      `https://oauth.reddit.com/r/${subredditsJoined}/search`
    );
    url.searchParams.set("q", query);
    url.searchParams.set("restrict_sr", "true");
    url.searchParams.set("sort", "top");
    url.searchParams.set("t", "all");
    url.searchParams.set("type", "link");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("raw_json", "1");

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": redditUserAgent(),
        Accept: "application/json",
      },
      next: { revalidate: 3600 },
    });
    return parseListing(res);
  }

  const url = new URL(
    `https://www.reddit.com/r/${subredditsJoined}/search.json`
  );
  url.searchParams.set("q", query);
  url.searchParams.set("restrict_sr", "on");
  url.searchParams.set("sort", "top");
  url.searchParams.set("t", "all");
  url.searchParams.set("type", "link");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("raw_json", "1");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": redditUserAgent(),
      Accept: "application/json",
    },
    next: { revalidate: 3600 },
  });
  return parseListing(res);
}

/**
 * Find discussion threads for a title.
 * Prefer simple quoted title queries (boolean operators hurt recall).
 */
export async function searchRedditDiscussions(opts: {
  title: string;
  kind: "movie" | "tv";
  year?: string | null;
  limit?: number;
}): Promise<RedditSubmission[]> {
  const title = opts.title.trim();
  if (!title) return [];

  const year = opts.year?.slice(0, 4) || "";
  // Simple query — complex OR operators often return nothing
  const query = year ? `"${title}" ${year}` : `"${title}"`;

  const subs =
    opts.kind === "movie"
      ? ["movies", "TrueFilm", "MovieSuggestions"]
      : ["television", "TrueFilm", "televisionsuggestions"];

  // 1) PullPush first (most reliable from servers)
  let hits = await searchPullPush(query, subs, 10);

  // Retry without year if sparse
  if (hits.length < 3 && year) {
    const more = await searchPullPush(`"${title}"`, subs, 10);
    hits = dedupe([...hits, ...more]);
  }

  // 2) Official Reddit if still empty
  if (hits.length === 0) {
    hits = await searchOfficial(query, subs.join("+"), opts.limit ?? 15);
  }

  // Filter weak / off-topic: title should mention media name loosely
  const titleLower = title.toLowerCase();
  const tokens = titleLower
    .split(/\s+/)
    .filter((t) => t.length > 2 && !/^(the|and|of|a|an)$/.test(t));

  const relevant = hits.filter((h) => {
    const hay = `${h.title} ${h.selftext}`.toLowerCase();
    if (hay.includes(titleLower)) return true;
    const matched = tokens.filter((t) => hay.includes(t)).length;
    return matched >= Math.min(2, tokens.length);
  });

  const list = (relevant.length > 0 ? relevant : hits).filter(
    (h) =>
      h.selftext.length > 40 ||
      h.num_comments >= 10 ||
      h.score >= 20
  );

  list.sort(
    (a, b) => b.score + b.num_comments * 2 - (a.score + a.num_comments * 2)
  );

  return dedupe(list).slice(0, opts.limit ?? 10);
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

export function redditSearchUrl(title: string, kind: "movie" | "tv") {
  const sub = kind === "movie" ? "movies" : "television";
  return `https://www.reddit.com/r/${sub}/search/?q=${encodeURIComponent(title)}&restrict_sr=1&sort=top&t=all`;
}
