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
// PARKED 2026-09-23: api/cdn.reallyfast.xyz are NXDOMAIN (backend gone, not
// blocked). Picker shows Goated as Down. To resurrect, point GOATED_RESOLVER
// at the new backend base URL — no other code changes needed.

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
  init: RequestInit = {},
  timeoutMs = 12_000
): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const outer = init.signal ?? null;
  const signal =
    outer && typeof (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any === "function"
      ? (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any([outer, timeoutSignal])
      : (outer ?? timeoutSignal);
  const res = await fetch(url, {
    ...init,
    signal,
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    // Map to code — never reflect upstream body to clients.
    throw new Error(`reallyfast_unreachable_${res.status}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) throw new Error("reallyfast returned non-JSON");
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
 * Capped: difficulty >6 or attempts >200k aborts — prevents CPU DoS when
 * the server raises difficulty. Callers fall through to next backend.
 */
async function solvePoW(
  challenge: string,
  difficulty: number,
  maxAttempts = 200_000
): Promise<string> {
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 6) {
    throw new Error("proof-of-work difficulty out of range");
  }
  if (typeof challenge !== "string" || challenge.length === 0 || challenge.length > 256) {
    throw new Error("invalid proof-of-work challenge");
  }
  const deadline = Date.now() + 8_000;
  const prefix = "0".repeat(difficulty);
  const enc = new TextEncoder();
  for (let i = 0; i < maxAttempts; i++) {
    if (Date.now() > deadline) throw new Error("proof-of-work deadline exceeded");
    const buf = await crypto.subtle.digest(
      "SHA-256",
      enc.encode(`${challenge}${i}`)
    );
    const bytes = new Uint8Array(buf);
    let hex = "";
    for (let j = 0; j < bytes.length; j++) hex += bytes[j].toString(16).padStart(2, "0");
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
const RESOLVE_CACHE_MAX = 128;

function cachePrune(): void {
  const now = Date.now();
  for (const [k, v] of resolveCache) {
    if (now - v.at > RESOLVE_TTL_MS) resolveCache.delete(k);
  }
  while (resolveCache.size > RESOLVE_CACHE_MAX) {
    const oldest = resolveCache.keys().next().value;
    if (oldest == null) break;
    resolveCache.delete(oldest);
  }
}

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
  if (!Number.isSafeInteger(opts.id) || opts.id <= 0) throw new Error("invalid id");
  const key = mediaKey(opts);
  const hit = resolveCache.get(key);
  if (hit && Date.now() - hit.at < RESOLVE_TTL_MS) {
    resolveCache.delete(key);
    resolveCache.set(key, hit);
    return hit.t;
  }

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

  if (!raw.url || typeof raw.url !== "string" || !raw.url.startsWith("https://")) {
    throw new Error("reallyfast resolve returned no url");
  }

  const resolved: GoatedResolve = {
    url: raw.url,
    source: (raw.source as GoatedSource) || "Orbit",
    format: raw.format || "hls",
    availableSources: (raw.availableSources as GoatedSource[]) ?? GOATED_SOURCES,
    subtitles: raw.subtitles ?? [],
  };
  resolveCache.delete(key);
  resolveCache.set(key, { t: resolved, at: Date.now() });
  cachePrune();
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