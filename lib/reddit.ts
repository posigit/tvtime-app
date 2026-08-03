/**
 * Reddit search for discussion / review threads.
 *
 * Prefer OAuth app credentials when set (REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET)
 * — public .json endpoints are often blocked from cloud IPs.
 * Falls back to public search; always fails soft.
 */

type RedditListing = {
  data?: {
    children?: Array<{
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
    }>;
  };
};

let cachedToken: { value: string; exp: number } | null = null;

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

function redditUserAgent() {
  return (
    process.env.REDDIT_USER_AGENT?.trim() ||
    "tvtime-app/1.0 (personal media tracker)"
  );
}

export async function searchRedditDiscussions(opts: {
  query: string;
  subreddits: string;
  limit?: number;
}): Promise<RedditListing["data"]> {
  const limit = String(opts.limit ?? 15);
  const token = await getOAuthToken().catch(() => null);

  if (token) {
    const url = new URL(
      `https://oauth.reddit.com/r/${opts.subreddits}/search`
    );
    url.searchParams.set("q", opts.query);
    url.searchParams.set("restrict_sr", "true");
    url.searchParams.set("sort", "relevance");
    url.searchParams.set("t", "all");
    url.searchParams.set("type", "link");
    url.searchParams.set("limit", limit);
    url.searchParams.set("raw_json", "1");

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": redditUserAgent(),
        Accept: "application/json",
      },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      console.error(`Reddit OAuth search ${res.status}`);
      return undefined;
    }

    const text = await res.text();
    if (text.trimStart().startsWith("<")) {
      console.error("Reddit OAuth returned HTML");
      return undefined;
    }
    try {
      return (JSON.parse(text) as RedditListing).data;
    } catch {
      return undefined;
    }
  }

  // Public fallback (works from some networks; often blocked on cloud hosts)
  const url = new URL(
    `https://www.reddit.com/r/${opts.subreddits}/search.json`
  );
  url.searchParams.set("q", opts.query);
  url.searchParams.set("restrict_sr", "on");
  url.searchParams.set("sort", "relevance");
  url.searchParams.set("t", "all");
  url.searchParams.set("type", "link");
  url.searchParams.set("limit", limit);
  url.searchParams.set("raw_json", "1");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": redditUserAgent(),
      Accept: "application/json",
    },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    console.error(`Reddit public search ${res.status}`);
    return undefined;
  }

  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    console.error(
      "Reddit public search blocked (HTML). Set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET for OAuth."
    );
    return undefined;
  }

  try {
    return (JSON.parse(text) as RedditListing).data;
  } catch {
    return undefined;
  }
}

/** Deep-link when we cannot embed threads. */
export function redditSearchUrl(title: string, kind: "movie" | "tv") {
  const sub = kind === "movie" ? "movies" : "television";
  const q = encodeURIComponent(title);
  return `https://www.reddit.com/r/${sub}/search/?q=${q}&restrict_sr=1&sort=relevance`;
}
