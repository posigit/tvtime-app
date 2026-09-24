/**
 * data.vidsrc.sh stream-data client (server-side port of the embed's vsdec.js).
 *
 * API: GET https://data.vidsrc.sh/api.php?type=movie|tv&tmdb={id}
 *      [&season=N&episode=N][&stream_urls]
 * Returns plain JSON, EXCEPT data.stream_urls which — when protection is on —
 * is a single encrypted string (base64 ChaCha20 nonce||ciphertext) plus a
 * top-level `vs` carrying the per-5-minute-window WASM decryptor:
 *     vs: { w: <window>, wasm_url: "https://.../<w>.wasm" }  (preferred)
 *  or vs: { w: <window>, wasm: "<base64 wasm>" }             (inline fallback)
 * The WASM module exports alloc(len)->ptr, memory, decrypt(ptr,len)->outLen;
 * plaintext is outLen bytes at ptr+12 (12-byte nonce prefix), newline-split
 * into the URL array. Plain responses (stream_urls already an array) pass
 * through unchanged.
 *
 * Runs in Node (Vercel) and Workers unchanged — only WebAssembly + fetch.
 */

import {
  SHARED_UA as UA,
  fetchWithTimeout,
  isBlockedHost,
} from "@/lib/stream-proxy";

const VIDSRC_SH_API = "https://data.vidsrc.sh/api.php";
const VIDSRC_SH_REFERER = "https://vidsrc.sh/";

export type VidsrcShResolve = {
  title?: string | null;
  imdbId?: string | null;
  fileName?: string | null;
  backdrop?: string | null;
  /** Direct stream URLs (decrypted). Empty when the title has none. */
  urls: string[];
  /** Seek-preview thumbnails (VTT URL) when the API provides one. */
  thumbnailsUrl?: string | null;
  subtitles: { language: string; label: string; url: string }[];
};

type VsApiResponse = {
  status_code?: string | number;
  data?: {
    title?: string;
    imdb_id?: string;
    file_name?: string;
    backdrop?: string;
    stream_urls?: string | string[];
  };
  /** Seek-preview thumbnails + default subs live TOP-level (not under data). */
  thumbnails_url?: string;
  default_subs?: { language?: string; label?: string; url?: string }[];
  vs?: {
    w?: string | number | null;
    wasm_url?: string;
    wasm?: string;
  };
};

type WasmDecryptor = {
  alloc: (len: number) => number;
  decrypt: (ptr: number, len: number) => number;
  memory: WebAssembly.Memory;
};

function b64ToBytes(s: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(s, "base64"));
  }
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

/** Bounded WASM module cache keyed by window. Evicts oldest + drops failures. */
const moduleCache = new Map<string, Promise<WebAssembly.Module>>();
const MODULE_CACHE_MAX = 8;

function cacheSet(key: string, p: Promise<WebAssembly.Module>): void {
  if (moduleCache.has(key)) moduleCache.delete(key);
  moduleCache.set(key, p);
  // Evict oldest beyond cap.
  while (moduleCache.size > MODULE_CACHE_MAX) {
    const oldest = moduleCache.keys().next().value;
    if (oldest == null) break;
    moduleCache.delete(oldest);
  }
  // Never poison the window on failure.
  p.catch(() => {
    if (moduleCache.get(key) === p) moduleCache.delete(key);
  });
}

function moduleFor(vs: NonNullable<VsApiResponse["vs"]>): Promise<WebAssembly.Module> | null {
  const w = vs.w == null ? null : String(vs.w);
  if (vs.wasm_url) {
    let target: URL;
    try {
      target = new URL(vs.wasm_url);
    } catch {
      throw new Error("vidsrc.sh returned an invalid wasm_url");
    }
    if (target.protocol !== "https:" || isBlockedHost(target.hostname)) {
      throw new Error("vidsrc.sh returned a blocked wasm_url");
    }
    const key = `u:${w ?? vs.wasm_url}`;
    let p = moduleCache.get(key);
    if (!p) {
      p = (async () => {
        const res = await fetchWithTimeout(
          target.toString(),
          {
            headers: { "User-Agent": UA, Referer: VIDSRC_SH_REFERER },
            cache: "no-store",
          },
          15_000
        );
        if (!res.ok) throw new Error(`wasm ${res.status}`);
        // compileStreaming first (falls back to buffer compile).
        try {
          return await WebAssembly.compileStreaming(res.clone());
        } catch {
          return WebAssembly.compile(await res.arrayBuffer());
        }
      })();
      cacheSet(key, p);
    }
    return p;
  }
  if (vs.wasm) {
    const key = `b:${w ?? "inline"}`;
    let p = moduleCache.get(key);
    if (!p) {
      const bytes = b64ToBytes(vs.wasm).slice();
      if (bytes.length === 0 || bytes.length > 4 * 1024 * 1024) {
        throw new Error("vidsrc.sh returned an invalid inline wasm");
      }
      p = WebAssembly.compile(bytes.buffer as ArrayBuffer);
      cacheSet(key, p);
    }
    return p;
  }
  return null;
}

async function decryptUrls(
  vs: NonNullable<VsApiResponse["vs"]>,
  encB64: string
): Promise<string[]> {
  const modP = moduleFor(vs);
  if (!modP) return [];
  const mod = await modP;
  const inst = await WebAssembly.instantiate(mod, {});
  const ex = inst.exports as unknown as Partial<WasmDecryptor>;
  if (
    typeof ex.alloc !== "function" ||
    typeof ex.decrypt !== "function" ||
    !ex.memory
  ) {
    throw new Error("wasm decryptor exports mismatch");
  }
  const enc = b64ToBytes(encB64);
  if (enc.length === 0 || enc.length > 256 * 1024) {
    throw new Error("vidsrc.sh returned an invalid encrypted payload");
  }
  const ptr = ex.alloc(enc.length);
  const mem = ex.memory.buffer;
  if (!Number.isInteger(ptr) || ptr < 0 || ptr + enc.length > mem.byteLength) {
    throw new Error("wasm decryptor returned an invalid pointer");
  }
  new Uint8Array(mem, ptr, enc.length).set(enc);
  const outLen = ex.decrypt(ptr, enc.length);
  if (!Number.isInteger(outLen) || outLen < 0 || outLen > 256 * 1024) {
    throw new Error("wasm decryptor returned an invalid length");
  }
  if (ptr + 12 + outLen > mem.byteLength) {
    throw new Error("wasm decryptor output out of bounds");
  }
  const text = new TextDecoder().decode(
    new Uint8Array(mem, ptr + 12, outLen)
  );
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function vidsrcShResolve(opts: {
  type: "movie" | "tv";
  id: number;
  season?: number;
  episode?: number;
}): Promise<VidsrcShResolve> {
  if (!Number.isSafeInteger(opts.id) || opts.id <= 0) {
    throw new Error("invalid tmdb id");
  }
  if (opts.type === "tv" && (opts.season == null || opts.episode == null)) {
    throw new Error("season and episode are required for tv");
  }
  const q = new URLSearchParams({ type: opts.type, tmdb: String(opts.id) });
  if (opts.type === "tv" && opts.season != null && opts.episode != null) {
    q.set("season", String(opts.season));
    q.set("episode", String(opts.episode));
  }
  q.set("stream_urls", "");
  const res = await fetchWithTimeout(
    `${VIDSRC_SH_API}?${q.toString()}`,
    {
      headers: {
        "User-Agent": UA,
        Referer: VIDSRC_SH_REFERER,
        Accept: "application/json",
      },
      cache: "no-store",
    },
    15_000
  );
  if (!res.ok) throw new Error(`vidsrc.sh api ${res.status}`);
  const j = (await res.json()) as VsApiResponse;
  const d = j.data ?? {};
  let urls: string[] = [];
  if (Array.isArray(d.stream_urls)) {
    urls = d.stream_urls.filter(
      (u): u is string =>
        typeof u === "string" &&
        u.length > 0 &&
        u.startsWith("https://") &&
        (() => {
          try {
            const x = new URL(u);
            return x.protocol === "https:" && !isBlockedHost(x.hostname);
          } catch {
            return false;
          }
        })()
    );
  } else if (typeof d.stream_urls === "string" && d.stream_urls.length > 0) {
    if (j.vs) {
      const raw = await decryptUrls(j.vs, d.stream_urls);
      urls = raw.filter((u) => {
        try {
          const x = new URL(u);
          return x.protocol === "https:" && !isBlockedHost(x.hostname);
        } catch {
          return false;
        }
      });
    }
  }
  const thumbs =
    typeof j.thumbnails_url === "string" && j.thumbnails_url.length > 0
      ? j.thumbnails_url
      : null;
  let thumbsValidated: string | null = null;
  if (thumbs) {
    try {
      const x = new URL(thumbs, VIDSRC_SH_API);
      if (x.protocol === "https:" && !isBlockedHost(x.hostname)) {
        thumbsValidated = x.toString();
      }
    } catch {
      thumbsValidated = null;
    }
  }
  return {
    title: d.title ?? null,
    imdbId: d.imdb_id ?? null,
    fileName: d.file_name ?? null,
    backdrop: d.backdrop ?? null,
    urls,
    thumbnailsUrl: thumbsValidated,
    subtitles: Array.isArray(j.default_subs)
      ? j.default_subs.flatMap((s) =>
          s && typeof s.url === "string" && s.url.length > 0
            ? (() => {
                try {
                  const x = new URL(s.url);
                  if (x.protocol !== "https:" || isBlockedHost(x.hostname)) return [];
                } catch {
                  return [];
                }
                return [
                  {
                    language: typeof s.language === "string" ? s.language : "en",
                    label: typeof s.label === "string" ? s.label : "English",
                    url: s.url,
                  },
                ];
              })()
            : []
        )
      : [],
  };
}

/** Origin (protocol + host) of a stream URL — tokens are per-host. */
export function vidsrcShOrigin(u: string): string {
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.host}`;
  } catch {
    return "";
  }
}

/** Per-origin JWT cache (tokens live ~4h; refresh hourly to stay safe). Bounded LRU. */
const tokenCache = new Map<string, { token: string; at: number }>();
const TOKEN_TTL_MS = 60 * 60 * 1000;
const TOKEN_CACHE_MAX = 32;

/**
 * Fetch a playback token from the stream host (mirrors the embed player's
 * loadStream: GET {origin}/generate.php). Tokens are IP-bound (/24), so the
 * SAME deployment that mints must also proxy the bytes — never hand raw
 * tokenized URLs to the browser.
 */
export async function vidsrcShToken(origin: string): Promise<string> {
  const hit = tokenCache.get(origin);
  if (hit && Date.now() - hit.at < TOKEN_TTL_MS) {
    // Refresh LRU order.
    tokenCache.delete(origin);
    tokenCache.set(origin, hit);
    return hit.token;
  }
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new Error("invalid stream origin");
  }
  if (originUrl.protocol !== "https:" || isBlockedHost(originUrl.hostname)) {
    throw new Error("blocked stream origin");
  }
  const res = await fetchWithTimeout(
    `${origin}/generate.php`,
    {
      headers: { "User-Agent": UA, Referer: "https://cloudorchestranova.com/" },
      cache: "no-store",
    },
    10_000
  );
  if (!res.ok) {
    // Do not cache failures.
    throw new Error(`token endpoint ${res.status}`);
  }
  const token = (await res.text()).trim();
  if (!token || token.length > 4096) throw new Error("empty playback token");
  tokenCache.delete(origin);
  tokenCache.set(origin, { token, at: Date.now() });
  while (tokenCache.size > TOKEN_CACHE_MAX) {
    const oldest = tokenCache.keys().next().value;
    if (oldest == null) break;
    tokenCache.delete(oldest);
  }
  return token;
}

/** Append ?token= like the embed player's applyToken (respects __TOKEN__). */
export function applyVidsrcToken(url: string, token: string): string {
  if (!token) return url;
  if (url.includes("__TOKEN__")) return url.split("__TOKEN__").join(token);
  return url + (url.includes("?") ? "&" : "?") + "token=" + token;
}

// ---------- proxy URL signing (abuse guard, WebCrypto — Node + Workers) ----------
// /api/vidsrc-sh/media would otherwise be an open https fetch proxy —
// anyone could burn our bandwidth. Stream + media routes sign every URL
// they mint with AUTH_SECRET, so only OUR chain validates. Cross-instance
// safe (shared env secret, no shared memory). Signatures expire (default
// 1h) so leaked URLs cannot be replayed forever.

let warnedNoSecret = false;

function proxySecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("[vidsrc-sh] AUTH_SECRET missing/short in production — refusing to sign");
  }
  if (!warnedNoSecret) {
    warnedNoSecret = true;
    console.warn(
      "[vidsrc-sh] AUTH_SECRET missing/short — proxy URLs signed with an insecure dev fallback (non-production only)"
    );
  }
  return "dev-only-insecure-proxy-key";
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  const b64 = typeof Buffer !== "undefined"
    ? Buffer.from(s, "binary").toString("base64")
    : btoa(s);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacHex(target: string, exp: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(proxySecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${exp}.${target}`)
  );
  return b64url(new Uint8Array(sig));
}

/** Build an expiring signed /api/vidsrc-sh/media URL for a target. */
export async function signProxyUrl(target: string, ttlSec = 3600): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = await hmacHex(target, exp);
  return `/api/vidsrc-sh/media?url=${encodeURIComponent(target)}&exp=${exp}&sig=${sig}`;
}

/** Sync signing is not supported (WebCrypto is async) — kept to fail loudly if reused. */
export function signProxyUrlSync(): string {
  throw new Error("signProxyUrl is async — await signProxyUrl(target)");
}

/** True when sig matches target and exp is fresh (constant-time compare). */
export async function verifyProxyUrl(
  target: string,
  sig: string | null,
  expRaw: string | null
): Promise<boolean> {
  if (!sig || !expRaw) return false;
  if (!/^\d+$/.test(expRaw)) return false;
  const exp = Number(expRaw);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(exp) || exp < now - 60 || exp > now + 7 * 24 * 3600) {
    return false;
  }
  const expected = await hmacHex(target, exp);
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
