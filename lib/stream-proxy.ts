/**
 * Shared streaming-proxy primitives (Next.js server runtime).
 *
 * Single source of truth for: UA, timeout fetch, SSRF guards, media-param
 * validation, Retry-After parsing, playlist rewrite, gunzip sniffing.
 * Worker (resolver-server/worker.js) mirrors this logic in plain JS —
 * keep the two in sync when changing regexes or host rules.
 */

export const SHARED_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Fetch with a fail-fast timeout composed with an optional outer signal. No listener leaks. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12_000
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const outer = init.signal ?? null;
  if (!outer) {
    return fetch(url, { ...init, signal: timeoutSignal });
  }
  if (outer.aborted) throw new DOMException("Aborted", "AbortError");
  // AbortSignal.any is available in Node 20+ / modern runtimes.
  const combined =
    typeof (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any ===
    "function"
      ? (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any([
          outer,
          timeoutSignal,
        ])
      : timeoutSignal;
  if (combined === timeoutSignal) {
    const onAbort = () => {
      // No-op: timeout signal fires on its own; outer abort maps to same error.
    };
    outer.addEventListener("abort", onAbort, { once: true });
    try {
      return await fetch(url, { ...init, signal: timeoutSignal });
    } finally {
      outer.removeEventListener("abort", onAbort);
    }
  }
  return fetch(url, { ...init, signal: combined });
}

/** True for decimal/octal/hex-encoded IPv4 that bypass naive ^127\. checks. */
function isNumericIPv4(host: string): boolean {
  const h = host.toLowerCase().trim();
  // Pure decimal (e.g. 2130706433 == 127.0.0.1)
  if (/^\d{1,10}$/.test(h)) {
    const n = Number(h);
    if (Number.isSafeInteger(n) && n >= 0 && n <= 4294967295) return true;
    return false;
  }
  // Dotted with hex/octal parts (0x7f.0.0.1, 0177.0.0.1)
  if (/^[0-9a-fx.]+$/.test(h) && h.includes(".")) {
    const parts = h.split(".");
    if (parts.length >= 2 && parts.length <= 4) {
      let allNumeric = true;
      for (const p of parts) {
        if (!/^(0x[0-9a-f]+|0[0-7]*|[0-9]+)$/.test(p)) {
          allNumeric = false;
          break;
        }
      }
      if (allNumeric) return true;
    }
  }
  return false;
}

function ipv4Octets(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const octets = m.slice(1, 5).map(Number);
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return octets;
}

/** Strict SSRF blocklist: private, loopback, link-local, CGNAT, reserved, numeric forms. */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().trim().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h === "[::1]" || h === "::1") return true;
  // IPv6 loopback / link-local / unique-local / unspecified
  if (h.includes(":")) {
    if (h === "::" || h === "::ffff:127.0.0.1") return true;
    if (h.startsWith("fe80:") || h.startsWith("fec0:") || h.startsWith("fc00:") || h.startsWith("fd00:")) return true;
    if (h.startsWith("::ffff:")) {
      const v4 = h.slice("::ffff:".length);
      if (ipv4Octets(v4)) return isBlockedHost(v4);
      return true;
    }
    return false;
  }
  if (isNumericIPv4(h)) return true;
  if (h.startsWith("0x") || /^0[0-7]+$/.test(h)) return true;
  const oct = ipv4Octets(h);
  if (oct) {
    const [a, b] = oct;
    if (a === 127 || a === 0 || a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 0) return true; // 192.0.0.0/24
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
    if (a === 203 && b === 0) return true; // TEST-NET-3
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  // Single-label / non-dot hostnames never valid upstream targets
  if (!h.includes(".")) return true;
  return false;
}

/** Validated media params shared by all stream/mint routes. Throws with .status=400 on bad input. */
export type MediaParams = {
  type: "movie" | "tv";
  id: number;
  season?: number;
  episode?: number;
};

function bad(message: string): Error & { status?: number } {
  const e = new Error(message) as Error & { status?: number };
  e.status = 400;
  return e;
}

function parsePositiveInt(raw: string | null, name: string): number | undefined {
  if (raw == null || raw === "") return undefined;
  if (!/^\d+$/.test(raw.trim())) throw bad(`invalid ${name}`);
  const n = Number(raw.trim());
  if (!Number.isSafeInteger(n) || n < 0 || n > 1_000_000) throw bad(`invalid ${name}`);
  return n;
}

export function parseMediaParams(sp: URLSearchParams): MediaParams {
  const type = sp.get("type");
  const idRaw = sp.get("id");
  if ((type !== "movie" && type !== "tv") || !idRaw) {
    throw bad("type (movie|tv) and id are required");
  }
  const id = parsePositiveInt(idRaw, "id");
  if (id == null || id <= 0) throw bad("invalid id");
  const season = parsePositiveInt(sp.get("season"), "season");
  const episode = parsePositiveInt(sp.get("episode"), "episode");
  if (type === "tv" && (season == null || episode == null)) {
    throw bad("season and episode are required for tv");
  }
  if (type === "movie" && (season != null || episode != null)) {
    throw bad("season/episode are only valid for tv");
  }
  return { type, id, season, episode };
}

/** Parse Retry-After (seconds or HTTP-date) → seconds or null. */
export function parseRetryAfterSeconds(header: string | null): number | null {
  if (!header) return null;
  const h = header.trim();
  if (/^\d+$/.test(h)) {
    const n = Number(h);
    return Number.isFinite(n) && n >= 0 && n <= 3600 ? n : null;
  }
  const t = Date.parse(h);
  if (!Number.isNaN(t)) {
    const diff = Math.round((t - Date.now()) / 1000);
    if (diff >= 0 && diff <= 3600) return diff;
  }
  return null;
}

/** Port-aware absolute URL matcher (covers :8080). */
export const ABSOLUTE_URL_RE =
  /https?:\/\/[a-z0-9.-]+(?::\d+)?(\/[^\s"'<>]*)/gi;

/**
 * Rewrite every playlist reference through toProxy, resolved against base.
 * Covers quoted URI attrs, absolute URLs (with ports), protocol-relative //,
 * and bare relative lines. Never double-proxies /api/ paths or data: URIs.
 */
export function rewritePlaylistBody(
  body: string,
  base: URL,
  toProxy: (absolute: string) => string | null
): string {
  const proxied = (ref: string): string | null => {
    try {
      const abs = ref.startsWith("//")
        ? `${base.protocol}${ref}`
        : new URL(ref, base).toString();
      return toProxy(abs);
    } catch {
      return null;
    }
  };
  let out = body.replace(
    /(URI=")([^"]*)(")/g,
    (full: string, pre: string, ref: string, post: string) => {
      if (!ref || ref.startsWith("data:")) return full;
      const p = proxied(ref);
      return p ? `${pre}${p}${post}` : full;
    }
  );
  ABSOLUTE_URL_RE.lastIndex = 0;
  out = out.replace(ABSOLUTE_URL_RE, (full: string) => toProxy(full) ?? full);
  out = out
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return line;
      if (t.startsWith("/api/")) return line;
      if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith("/")) return line;
      return proxied(t) ?? line;
    })
    .join("\n");
  return out;
}

/** #EXTM3U sniff from raw bytes (never route binary through .text()). */
export function isPlaylistBytes(buf: Uint8Array): boolean {
  return buf.length > 6 && Buffer.from(buf.subarray(0, 7)).toString("latin1") === "#EXTM3U";
}

/** True when content-type could plausibly be a playlist (sniff to confirm). */
export function couldBePlaylistContentType(ct: string | null): boolean {
  if (!ct || ct === "") return true;
  return (
    ct.includes("mpegurl") ||
    ct.includes("text") ||
    ct.includes("octet-stream") ||
    ct.includes("x-mpegurl")
  );
}
