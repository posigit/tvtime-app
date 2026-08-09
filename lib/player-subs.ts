/**
 * Subtitle helpers for the native player: VTT inject, external fetch, styles.
 * Stream-embedded CC is demoted to "hidden" so SubtitleOverlay owns paint.
 */

import type { VixSettings } from "@/lib/vix-settings";

export const SUB_FONT_SCALE: Record<VixSettings["subFontSize"], number> = {
  sm: 1,
  md: 1.12,
  lg: 1.25,
};

export const SUB_COLORS: Record<VixSettings["subColor"], string> = {
  white: "#ffffff",
  yellow: "#ffe566",
  cyan: "#7dd3fc",
};

export type SubSource = "auto" | "off" | "stream" | "vdrk" | "opensub";

export function parseVttTime(t: string): number {
  const parts = t.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/** Keep cues active for SubtitleOverlay without native ::cue paint. */
export function demoteShowingTracks(video: HTMLVideoElement) {
  const ttl = video.textTracks;
  for (let i = 0; i < ttl.length; i++) {
    const t = ttl[i];
    if (t.kind !== "subtitles" && t.kind !== "captions") continue;
    if (t.mode === "showing") t.mode = "hidden";
  }
}

/** Inject an external VTT as a native text track (overlay draws cues). */
export function injectVttTrack(
  video: HTMLVideoElement,
  vtt: string,
  label: string,
  show: boolean,
  delaySeconds = 0
): TextTrack | null {
  const track = video.addTextTrack("subtitles", label, "en");
  track.mode = show ? "hidden" : "disabled";
  const delay = Number.isFinite(delaySeconds) ? delaySeconds : 0;
  const lines = vtt.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(
      /(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})/
    );
    if (m) {
      const start = Math.max(0, parseVttTime(m[1]) + delay);
      const end = Math.max(start + 0.05, parseVttTime(m[2]) + delay);
      i++;
      const text: string[] = [];
      while (i < lines.length && lines[i].trim() !== "") {
        text.push(lines[i]);
        i++;
      }
      try {
        track.addCue(new VTTCue(start, end, text.join("\n")));
      } catch {
        /* skip malformed cue */
      }
    } else {
      i++;
    }
  }
  return track;
}

export type ExternalVttResult = { vtt: string; label: string };

/**
 * Fetch an external VTT (VDRK or OpenSubtitles) for the current item.
 * Returns { vtt, label } or null.
 */
export async function fetchExternalVtt(opts: {
  source: "vdrk" | "opensub";
  type?: "movie" | "tv";
  tmdbId?: number;
  season?: number;
  episode?: number;
  imdbId?: string | null;
}): Promise<ExternalVttResult | null> {
  if (opts.source === "vdrk") {
    if (!opts.tmdbId) return null;
    try {
      const base = `https://cache.vdrk.site/v1/vtt/${opts.type === "tv" ? "tv" : "movie"}/${opts.tmdbId}`;
      const path =
        opts.type === "tv" && opts.season != null && opts.episode != null
          ? `${base}/${opts.season}/${opts.episode}/English.vtt`
          : `${base}/English.vtt`;
      const res = await fetch(path);
      if (!res.ok) return null;
      const vtt = await res.text();
      if (vtt.trim().length === 0) return null;
      return { vtt, label: "English (VDRK)" };
    } catch {
      return null;
    }
  }

  if (!opts.imdbId) return null;
  try {
    const q = new URLSearchParams({ imdbId: opts.imdbId, lang: "en" });
    if (opts.season != null) q.set("season", String(opts.season));
    if (opts.episode != null) q.set("episode", String(opts.episode));
    const res = await fetch(`/api/vixsrc/subs?${q.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { vtt?: string; label?: string };
    if (!data.vtt) return null;
    return { vtt: data.vtt, label: data.label ?? "OpenSubtitles (English)" };
  } catch {
    return null;
  }
}
