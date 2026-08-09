/**
 * Resolve Vix / Goated master playlist URLs for native playback.
 *
 * Goated has TWO backends behind one API: Valenox (default — user's choice,
 * 2026-08-09) then Orbit (fallback), then Vix as the LAST native fallback
 * before iframe. Each attempt is time-bounded so a throttled resolver
 * ("Loading…" forever) fails fast and moves to the next source instead of
 * hanging the player.
 */

import type { StreamSource } from "@/lib/player-native-types";

export type StreamResolveResult = {
  playlistUrl: string | null;
  imdbId: string | null;
  failed: boolean;
  errorMessage?: string;
  /** Which backend actually produced the playlist (diagnostics). */
  usedSource?: "valenox" | "orbit" | "vix";
  /** True when the goated cascade exhausted and vix was tried as the last native fallback. */
  fellBackToVix?: boolean;
  /** Per-attempt outcomes (diagnostics / console). */
  attempts?: Array<{ source: string; ok: boolean; error?: string }>;
};

/**
 * Goated backend order: Orbit first (media proven working end-to-end through
 * the proxy, 2026-08-09), Valenox fallback (resolves but its media worker
 * rejects our proxy's origins — 403 Origin not allowed). Valenox stays in
 * the chain in case its lock opens, but never blocks playback.
 */
const GOATED_ORDER = ["Orbit", "Valenox"] as const;

/**
 * 30s cap per attempt. The reallyfast resolver is documented to take 15-40s
 * (and up to 90s) when throttled; this matches the observed ceiling so a
 * slow-but-alive resolver still resolves, but a hung/blackhole request moves
 * on instead of freezing the player forever.
 */
const RESOLVE_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(
  url: string,
  signal?: AbortSignal,
  timeoutMs: number = RESOLVE_TIMEOUT_MS
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onOuterAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onOuterAbort);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

async function resolveOne(
  routeLabel: "vix" | "goated",
  params: URLSearchParams,
  signal?: AbortSignal
): Promise<{ playlistUrl: string | null; imdbId: string | null; error?: string }> {
  try {
    const res = await fetchWithTimeout(
      `/api/${routeLabel === "vix" ? "vixsrc" : "goated"}/stream?${params.toString()}`,
      signal
    );
    if (!res.ok) {
      const text = await res.text();
      return {
        playlistUrl: null,
        imdbId: null,
        error: `stream route ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as {
      url?: string;
      playlistUrl?: string;
      imdbId?: string | null;
    };
    const imdbId = data?.imdbId ?? null;
    if (data?.playlistUrl) return { playlistUrl: data.playlistUrl, imdbId };
    if (data?.url) {
      return {
        playlistUrl: `/api/goated/media?url=${encodeURIComponent(data.url)}`,
        imdbId,
      };
    }
    return { playlistUrl: null, imdbId, error: "no playlist in response" };
  } catch (err) {
    // Aborted by the caller (effect cleanup) = not a failure, never report it.
    if (signal?.aborted) return { playlistUrl: null, imdbId: null };
    return {
      playlistUrl: null,
      imdbId: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function resolveStreamPlaylist(opts: {
  source: StreamSource;
  type: "movie" | "tv";
  tmdbId: number;
  season?: number;
  episode?: number;
  signal?: AbortSignal;
}): Promise<StreamResolveResult> {
  const base = new URLSearchParams({
    type: opts.type,
    id: String(opts.tmdbId),
  });
  if (opts.season != null) base.set("season", String(opts.season));
  if (opts.episode != null) base.set("episode", String(opts.episode));

  const attempts: StreamResolveResult["attempts"] = [];
  const record = (
    source: string,
    r: { playlistUrl: string | null; error?: string }
  ) => attempts!.push({ source, ok: !!r.playlistUrl, error: r.error });

  // Vix: single attempt — unchanged behavior.
  if (opts.source === "vix") {
    const r = await resolveOne("vix", base, opts.signal);
    record("vix", r);
    return {
      playlistUrl: r.playlistUrl,
      imdbId: r.imdbId,
      failed: !r.playlistUrl,
      errorMessage: r.error,
      usedSource: r.playlistUrl ? "vix" : undefined,
      attempts,
    };
  }

  // Goated cascade: Valenox → Orbit → Vix (last native fallback).
  let imdbId: string | null = null;
  for (const backend of GOATED_ORDER) {
    if (opts.signal?.aborted) {
      return { playlistUrl: null, imdbId, failed: false, attempts };
    }
    const p = new URLSearchParams(base);
    p.set("source", backend);
    const r = await resolveOne("goated", p, opts.signal);
    record(`goated:${backend}`, r);
    if (r.imdbId) imdbId = r.imdbId;
    if (r.playlistUrl) {
      return {
        playlistUrl: r.playlistUrl,
        imdbId,
        failed: false,
        usedSource: backend.toLowerCase() as "valenox" | "orbit",
        attempts,
      };
    }
  }

  // Last native fallback — vix before giving up to iframe.
  if (opts.signal?.aborted) {
    return { playlistUrl: null, imdbId, failed: false, attempts };
  }
  const v = await resolveOne("vix", base, opts.signal);
  record("vix", v);
  if (v.playlistUrl) {
    return {
      playlistUrl: v.playlistUrl,
      imdbId: v.imdbId ?? imdbId,
      failed: false,
      usedSource: "vix",
      fellBackToVix: true,
      attempts,
    };
  }
  const lastErr = attempts.find((a) => !a.ok)?.error;
  return {
    playlistUrl: null,
    imdbId: v.imdbId ?? imdbId,
    failed: true,
    errorMessage: lastErr ?? "all sources failed",
    fellBackToVix: true,
    attempts,
  };
}