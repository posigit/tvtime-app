/**
 * Resolve Vix / Goated master playlist URLs for native playback.
 */

import type { StreamSource } from "@/lib/player-native-types";

export type StreamResolveResult = {
  playlistUrl: string | null;
  imdbId: string | null;
  failed: boolean;
  errorMessage?: string;
};

export async function resolveStreamPlaylist(opts: {
  source: StreamSource;
  type: "movie" | "tv";
  tmdbId: number;
  season?: number;
  episode?: number;
  signal?: AbortSignal;
}): Promise<StreamResolveResult> {
  const params = new URLSearchParams({
    type: opts.type,
    id: String(opts.tmdbId),
  });
  if (opts.season != null) params.set("season", String(opts.season));
  if (opts.episode != null) params.set("episode", String(opts.episode));

  const isGoated = opts.source === "goated";
  try {
    const res = await fetch(
      `${isGoated ? "/api/goated/stream" : "/api/vixsrc/stream"}?${params.toString()}`,
      { signal: opts.signal }
    );
    if (!res.ok) {
      const text = await res.text();
      return {
        playlistUrl: null,
        imdbId: null,
        failed: true,
        errorMessage: `stream route ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as {
      url?: string;
      playlistUrl?: string;
      imdbId?: string | null;
    };
    const imdbId = data?.imdbId ?? null;
    if (data?.playlistUrl) {
      return { playlistUrl: data.playlistUrl, imdbId, failed: false };
    }
    if (data?.url) {
      return {
        playlistUrl: `/api/goated/media?url=${encodeURIComponent(data.url)}`,
        imdbId,
        failed: false,
      };
    }
    return { playlistUrl: null, imdbId, failed: true };
  } catch (err) {
    if (opts.signal?.aborted) {
      return { playlistUrl: null, imdbId: null, failed: false };
    }
    return {
      playlistUrl: null,
      imdbId: null,
      failed: true,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
