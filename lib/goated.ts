/**
 * goated.cx (reallyfast.xyz backend) stream resolver.
 *
 * goated.cx is a movie-web-style app whose backend hands out signed HLS
 * playlists. This lib is the "ask for the video" step: solve their trivial
 * SHA-256 proof-of-work, POST /api/resolve, get a signed master m3u8 URL.
 *
 * I am Orbit (default): adaptive HLS (1080p/2592x1080, 720p, 360p + separate
 * English AAC) on cdn.reallyfast.xyz + a Cloudflare Worker for segments. The
 * media is referer/origin-locked to goated.cx, so the player must go through
 * the media proxy (app/api/goated/media) — NOT the browser cross-origin.
 *
 * Resolve URLs are time-signed (~90s) and /api/resolve 429s on burst, so we
 * cache resolved URLs per media key ~60s (per serverless instance).
 */

export const GOATED_RESOLVER = "https://api.reallyfast.xyz";
export const GOATED_ORIGIN = "https://goated.cx";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type GoatedSource = "Orbit" | "Valenox";
export const GOATED_SOURCES: GoatedSource[] = ["Orbit", "Valenox"];

export type GoatedSubtitle = {
  language: string;
  label: string;
  url: string;
  source: "VDRK" | "OpenSubtitles";
};

export type GoatedResolve = {
  url: string;
  source: GoatedSource;
  format: string;
  availableSources: GoatedSource[];
  subtitles: GoatedSubtitle[];
};

type Challenge = { challenge: string; difficulty: number; expiresIn: number };

// ---------- HTTP ----------

async function fetchJson<T>(
  url: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`reallyfast ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ---------- Proof of work ----------

async function getChallenge(): Promise<Challenge> {
  return fetchJson<Challenge>(
    `${GOATED_RESOLVER}/api/challenge`,
    { method: "GET" }
  );
}

/**
 * Find nonce where SHA-256(challenge + nonce) hex starts with `difficulty`
 * zeros. WebCrypto (crypto.subtle) is available in Next server runtime.
 */
async function solvePoW(
  challenge: string,
  difficulty: number,
  maxAttempts = 3_000_000
): Promise<string> {
  const prefix = "0".repeat(difficulty);
  const enc = new TextEncoder();
  for (let i = 0; i < maxAttempts; i++) {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      enc.encode(`${challenge}${i}`)
    );
    const hex = [...new Uint8Array(buf)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (hex.startsWith(prefix)) return String(i);
  }
  throw new Error("proof-of-work timed out");
}

async function solveToken(): Promise<{ challenge: string; nonce: string }> {
  const ch = await getChallenge();
  const nonce = await solvePoW(ch.challenge, ch.difficulty);
  return { challenge: ch.challenge, nonce };
}

// ---------- Resolve + cache ----------

const resolveCache = new Map<
  string,
  { t: GoatedResolve; at: number }
>();
const RESOLVE_TTL_MS = 60_000;

function mediaKey(opts: {
  type: "movie" | "tv";
  id: number;
  season?: number;
  episode?: number;
  source?: GoatedSource;
}): string {
  return `${opts.type}:${opts.id}:${opts.season ?? "-"}:${opts.episode ?? "-"}:${opts.source ?? "Orbit"}`;
}

export async function goatedResolve(opts: {
  type: "movie" | "tv";
  id: number;
  season?: number;
  episode?: number;
  source?: GoatedSource;
}): Promise<GoatedResolve> {
  const key = mediaKey(opts);
  const hit = resolveCache.get(key);
  if (hit && Date.now() - hit.at < RESOLVE_TTL_MS) return hit.t;

  const { challenge, nonce } = await solveToken();
  const body: Record<string, string | number> = {
    mediaType: opts.type,
    id: String(opts.id),
    challenge,
    nonce,
  };
  if (opts.season != null) body.season = opts.season;
  if (opts.episode != null) body.episode = opts.episode;
  if (opts.source) body.source = opts.source;

  const raw = await fetchJson<{
    url?: string;
    source?: string;
    format?: string;
    availableSources?: string[];
    subtitles?: GoatedSubtitle[];
  }>(`${GOATED_RESOLVER}/api/resolve`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!raw.url) throw new Error("reallyfast resolve returned no url");

  const resolved: GoatedResolve = {
    url: raw.url,
    source: (raw.source as GoatedSource) || "Orbit",
    format: raw.format || "hls",
    availableSources: (raw.availableSources as GoatedSource[]) ?? GOATED_SOURCES,
    subtitles: raw.subtitles ?? [],
  };
  resolveCache.set(key, { t: resolved, at: Date.now() });
  return resolved;
}

/** Resolver for subtitles only (same PoW + /api/subtitles). */
export async function goatedSubtitles(opts: {
  type: "movie" | "tv";
  id: number;
  season?: number;
  episode?: number;
}): Promise<GoatedSubtitle[]> {
  try {
    const { challenge, nonce } = await solveToken();
    const raw = await fetchJson<{ subtitles?: GoatedSubtitle[] }>(
      `${GOATED_RESOLVER}/api/subtitles`,
      {
        method: "POST",
        body: JSON.stringify({
          mediaType: opts.type,
          id: String(opts.id),
          ...(opts.season != null ? { season: opts.season } : {}),
          ...(opts.episode != null ? { episode: opts.episode } : {}),
          challenge,
          nonce,
        }),
      }
    );
    return raw.subtitles ?? [];
  } catch {
    // Subtitles are a bonus — non-fatal.
    return [];
  }
}