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

import { createHmac, timingSafeEqual } from "crypto";

const VIDSRC_SH_API = "https://data.vidsrc.sh/api.php";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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

/** WASM module cache keyed by window (mirrors vsdec.js moduleCache). */
const moduleCache = new Map<string, Promise<WebAssembly.Module>>();

function moduleFor(vs: NonNullable<VsApiResponse["vs"]>): Promise<WebAssembly.Module> | null {
  const w = vs.w == null ? null : String(vs.w);
  if (vs.wasm_url) {
    const key = `u:${w ?? vs.wasm_url}`;
    let p = moduleCache.get(key);
    if (!p) {
      p = (async () => {
        const res = await fetch(vs.wasm_url as string, {
          headers: { "User-Agent": UA, Referer: "https://vidsrc.sh/" },
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`wasm ${res.status}`);
        // compileStreaming first (falls back to buffer compile).
        try {
          return await WebAssembly.compileStreaming(res.clone());
        } catch {
          return WebAssembly.compile(await res.arrayBuffer());
        }
      })();
      moduleCache.set(key, p);
    }
    return p;
  }
  if (vs.wasm) {
    const key = `b:${w ?? "inline"}`;
    let p = moduleCache.get(key);
    if (!p) {
      const bytes = b64ToBytes(vs.wasm).slice();
      p = WebAssembly.compile(bytes.buffer as ArrayBuffer);
      moduleCache.set(key, p);
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
  const ptr = ex.alloc(enc.length);
  new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
  const outLen = ex.decrypt(ptr, enc.length);
  const text = new TextDecoder().decode(
    new Uint8Array(ex.memory.buffer, ptr + 12, outLen)
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
  const q = new URLSearchParams({ type: opts.type, tmdb: String(opts.id) });
  if (opts.type === "tv" && opts.season != null && opts.episode != null) {
    q.set("season", String(opts.season));
    q.set("episode", String(opts.episode));
  }
  q.set("stream_urls", "");
  const res = await fetch(`${VIDSRC_SH_API}?${q.toString()}`, {
    headers: {
      "User-Agent": UA,
      Referer: "https://ythd.org/",
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`vidsrc.sh api ${res.status}`);
  const j = (await res.json()) as VsApiResponse;
  const d = j.data ?? {};
  let urls: string[] = [];
  if (Array.isArray(d.stream_urls)) {
    urls = d.stream_urls.filter((u): u is string => typeof u === "string" && u.length > 0);
  } else if (typeof d.stream_urls === "string" && d.stream_urls.length > 0) {
    if (j.vs) urls = await decryptUrls(j.vs, d.stream_urls);
  }
  return {
    title: d.title ?? null,
    imdbId: d.imdb_id ?? null,
    fileName: d.file_name ?? null,
    backdrop: d.backdrop ?? null,
    urls,
    thumbnailsUrl:
      typeof j.thumbnails_url === "string" && j.thumbnails_url.length > 0
        ? j.thumbnails_url
        : null,
    subtitles: Array.isArray(j.default_subs)
      ? j.default_subs.flatMap((s) =>
          s && typeof s.url === "string" && s.url.length > 0
            ? [
                {
                  language: typeof s.language === "string" ? s.language : "en",
                  label: typeof s.label === "string" ? s.label : "English",
                  url: s.url,
                },
              ]
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

/** Per-origin JWT cache (tokens live ~4h; refresh hourly to stay safe). */
const tokenCache = new Map<string, { token: string; at: number }>();
const TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Fetch a playback token from the stream host (mirrors the embed player's
 * loadStream: GET {origin}/generate.php). Tokens are IP-bound (/24), so the
 * SAME deployment that mints must also proxy the bytes — never hand raw
 * tokenized URLs to the browser.
 */
export async function vidsrcShToken(origin: string): Promise<string> {
  const hit = tokenCache.get(origin);
  if (hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.token;
  const res = await fetch(`${origin}/generate.php`, {
    headers: { "User-Agent": UA, Referer: "https://cloudorchestranova.com/" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`token endpoint ${res.status}`);
  const token = (await res.text()).trim();
  if (!token) throw new Error("empty playback token");
  tokenCache.set(origin, { token, at: Date.now() });
  return token;
}

/** Append ?token= like the embed player's applyToken (respects __TOKEN__). */
export function applyVidsrcToken(url: string, token: string): string {
  if (!token) return url;
  if (url.includes("__TOKEN__")) return url.split("__TOKEN__").join(token);
  return url + (url.includes("?") ? "&" : "?") + "token=" + token;
}

// ---------- proxy URL signing (abuse guard) ----------
// /api/vidsrc-sh/media would otherwise be an open https fetch proxy —
// anyone could burn our bandwidth. Stream + media routes sign every URL
// they mint with AUTH_SECRET, so only OUR chain validates. Cross-instance
// safe (shared env secret, no shared memory).

let warnedNoSecret = false;

function proxySecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (!warnedNoSecret) {
    warnedNoSecret = true;
    console.warn(
      "[vidsrc-sh] AUTH_SECRET missing/short — proxy URLs signed with an insecure dev fallback"
    );
  }
  return "dev-only-insecure-proxy-key";
}

/** Build a signed /api/vidsrc-sh/media URL for a target. */
export function signProxyUrl(target: string): string {
  const sig = createHmac("sha256", proxySecret())
    .update(target)
    .digest("base64url");
  return `/api/vidsrc-sh/media?url=${encodeURIComponent(target)}&sig=${sig}`;
}

/** True when sig matches target (constant-time). */
export function verifyProxyUrl(target: string, sig: string | null): boolean {
  if (!sig) return false;
  const expected = createHmac("sha256", proxySecret())
    .update(target)
    .digest("base64url");
  const a = new TextEncoder().encode(sig);
  const b = new TextEncoder().encode(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
