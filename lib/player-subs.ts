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

export type VttCue = { start: number; end: number; text: string };

/**
 * Parse a WebVTT document into plain-text cues (no <video> element needed).
 * Used to render our own subtitles over iframe embeds (e.g. CineSrc) where
 * the embed's internal CC menu is hidden behind controls=false.
 */
export function parseVttCues(vtt: string, delaySeconds = 0): VttCue[] {
  const delay = Number.isFinite(delaySeconds) ? delaySeconds : 0;
  const cues: VttCue[] = [];
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
      const plain = text
        .join("\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .trim();
      if (plain) cues.push({ start, end, text: plain });
    } else {
      i++;
    }
  }
  return cues;
}

/** Active cue text at time t (seconds). */
export function cueTextAt(cues: VttCue[], t: number): string {
  if (!Number.isFinite(t)) return "";
  const lines: string[] = [];
  for (const c of cues) {
    if (t >= c.start && t < c.end) lines.push(c.text);
  }
  return lines.join("\n");
}

export type ExternalVttResult = { vtt: string; label: string; fileId?: number };

export type OpenSubListItem = {
  fileId: number;
  label: string;
  downloads: number;
  format: string;
};

/**
 * Fetch an external VTT (VDRK or OpenSubtitles) for the current item.
 * Returns { vtt, label } or null.
 * For opensub, pass fileId to download a specific list pick.
 */
export async function fetchExternalVtt(opts: {
  source: "vdrk" | "opensub";
  type?: "movie" | "tv";
  tmdbId?: number;
  season?: number;
  episode?: number;
  imdbId?: string | null;
  /** OpenSubtitles: download this file instead of auto-best. */
  fileId?: number;
  label?: string;
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
    if (opts.fileId != null) {
      q.set("fileId", String(opts.fileId));
      if (opts.label) q.set("label", opts.label);
    }
    const res = await fetch(`/api/vixsrc/subs?${q.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      vtt?: string;
      label?: string;
      fileId?: number;
    };
    if (!data.vtt) return null;
    return {
      vtt: data.vtt,
      label: data.label ?? "OpenSubtitles (English)",
      fileId: data.fileId,
    };
  } catch {
    return null;
  }
}

/** List OpenSubtitles English files (no download). */
export async function listOpenSubtitles(opts: {
  imdbId?: string | null;
  season?: number;
  episode?: number;
}): Promise<OpenSubListItem[]> {
  if (!opts.imdbId) return [];
  try {
    const q = new URLSearchParams({
      imdbId: opts.imdbId,
      lang: "en",
      list: "1",
    });
    if (opts.season != null) q.set("season", String(opts.season));
    if (opts.episode != null) q.set("episode", String(opts.episode));
    const res = await fetch(`/api/vixsrc/subs?${q.toString()}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: OpenSubListItem[] };
    // Player only needs the top 3 ranked files.
    return Array.isArray(data.items) ? data.items.slice(0, 3) : [];
  } catch {
    return [];
  }
}
