/**
 * Offline downloads — manifest, HLS parsing, storage accounting.
 *
 * Design (see plan):
 * - The manifest lives in IndexedDB (idb-keyval); segment bytes live in the
 *   `tvtime-downloads` Cache Storage bucket served by public/sw.js.
 * - Stored playlists are rewritten so every segment/key URI points at the
 *   same-origin `/api/dl?u=<canonical>` path the service worker serves —
 *   uniform for vix, goated and resolver backends, immune to signed-URL
 *   expiry (bytes are bytes once cached).
 * - Canonical keys strip volatile query params (token/expires/asn). The same
 *   normalizer is duplicated in plain JS inside sw.js (workers can't import
 *   TS path aliases).
 */

import { get, set } from "idb-keyval";

export const DL_CACHE = "tvtime-downloads";
const MANIFEST_IDB_KEY = "tvtime-download-manifest-v1";

export type DownloadItemType = "movie" | "episode";
export type DownloadState =
  | "queued"
  | "active"
  | "paused"
  | "done"
  | "error"
  | "missing";

export type DownloadRecord = {
  key: string;
  type: DownloadItemType;
  tmdbId: number;
  season?: number;
  episode?: number;
  title: string;
  subtitle?: string;
  quality: 480 | 720 | 1080 | "best";
  usedSource: string;
  durationSec: number;
  estimateBytes: number;
  /** Measured bytes once complete. */
  sizeBytes: number;
  bytesDone: number;
  totalSegments: number;
  doneSegments: number;
  /** Every Cache Storage key owned by this download (playlist + segments). */
  fileUrls: string[];
  state: DownloadState;
  error?: string;
  /** Auto-downloaded external subtitle (VTT text, kilobytes). */
  subVtt: string | null;
  subLabel: string | null;
  /**
   * Spare OpenSubtitles files (best + up to 2 alternates) for switching
   * when the default misaligns. Each VTT is kilobytes; capped at fetch.
   */
  subAlts: { vtt: string; label: string }[];
  /** IntroDB segments captured at download time (skip works offline). */
  segments: {
    intro: { start: number; end: number } | null;
    recap: { start: number; end: number } | null;
    outro: { start: number; end: number } | null;
  } | null;
  downloadedAt: number;
  /** Touch on play/finish — drives LRU eviction. */
  lastUsedAt: number;
};

export function downloadKey(
  type: DownloadItemType,
  tmdbId: number,
  season?: number,
  episode?: number
): string {
  return type === "movie"
    ? `m:${tmdbId}`
    : `e:${tmdbId}:${season ?? 0}:${episode ?? 0}`;
}

/** Offline playback URL for a finished download (served by sw.js). */
export function dlPlaylistUrl(key: string): string {
  return `/api/dl?playlist=${encodeURIComponent(key)}`;
}

/** Offline serve URL for one cached segment/key file. */
export function dlFileUrl(canonical: string): string {
  return `/api/dl?u=${encodeURIComponent(canonical)}`;
}

/* ------------------------------------------------------------------ */
/* Canonical media keys (mirrored in sw.js — keep the two in sync)     */
/* ------------------------------------------------------------------ */

const VOLATILE_PARAMS = ["token", "expires", "asn"];

function stripVolatile(raw: string): string {
  try {
    const u = new URL(raw, "http://localhost");
    for (const k of VOLATILE_PARAMS) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * Stable identity for a segment/key URL across signed-URL rotations.
 * Unwraps one level of same-origin proxy (`?url=<inner>`) then strips
 * volatile params. `media:` prefix avoids collisions with playlist keys.
 */
export function canonicalMediaKey(raw: string): string {
  const unwrap = (s: string): string => {
    try {
      const u = new URL(s, "http://localhost");
      const inner = u.searchParams.get("url");
      if (inner) return unwrap(inner);
      return stripVolatile(s);
    } catch {
      return s;
    }
  };
  return `media:${unwrap(raw)}`;
}

/* ------------------------------------------------------------------ */
/* HLS parsing                                                         */
/* ------------------------------------------------------------------ */

export type VariantInfo = {
  bandwidth: number;
  height: number;
  width: number;
  codecs: string | null;
  /** EXT-X-MEDIA audio GROUP-ID when the variant uses separate audio. */
  audioGroup: string | null;
  url: string;
};

export function isMasterPlaylist(text: string): boolean {
  return text.includes("#EXT-X-STREAM-INF");
}

export function parseMasterVariants(
  text: string,
  baseUrl: string
): VariantInfo[] {
  const lines = text.split(/\r?\n/);
  const out: VariantInfo[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
    const bw = Number(/BANDWIDTH=(\d+)/.exec(line)?.[1] ?? 0);
    const res = /RESOLUTION=(\d+)x(\d+)/.exec(line);
    const codecs = /CODECS="([^"]+)"/.exec(line)?.[1] ?? null;
    const audioGroup = /AUDIO="([^"]+)"/.exec(line)?.[1] ?? null;
    const uri = (lines[i + 1] ?? "").trim();
    if (!uri || uri.startsWith("#")) continue;
    try {
      out.push({
        bandwidth: bw,
        height: res ? Number(res[2]) : 0,
        width: res ? Number(res[1]) : 0,
        codecs,
        audioGroup,
        url: new URL(uri, baseUrl).toString(),
      });
    } catch {
      /* skip unresolvable URI */
    }
  }
  return out.sort((a, b) => b.bandwidth - a.bandwidth);
}

/** Highest variant at or under the target height; "best" = top bandwidth. */
export function pickVariant(
  variants: VariantInfo[],
  quality: 480 | 720 | 1080 | "best"
): VariantInfo | null {
  if (variants.length === 0) return null;
  if (quality === "best") return variants[0] ?? null;
  const withHeight = variants.filter((v) => v.height > 0);
  if (withHeight.length === 0) return variants[variants.length - 1] ?? null;
  const fitting = withHeight
    .filter((v) => v.height <= quality)
    .sort((a, b) => b.height - a.height);
  if (fitting.length > 0) return fitting[0] ?? null;
  return (
    [...withHeight].sort((a, b) => a.height - b.height)[0] ?? null
  );
}

export type MediaParts = {
  segments: string[];
  mapUrl: string | null;
  keys: { method: string; url: string }[];
  durationSec: number;
  sampleAes: boolean;
};

export function parseMediaPlaylist(
  text: string,
  baseUrl: string
): MediaParts {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const segments: string[] = [];
  const keys: { method: string; url: string }[] = [];
  let mapUrl: string | null = null;
  let durationSec = 0;
  let expectSegment = false;
  let sampleAes = false;
  for (const line of lines) {
    if (line.startsWith("#EXT-X-MAP:")) {
      const m = /URI="([^"]+)"/.exec(line);
      if (m) {
        try {
          mapUrl = new URL(m[1] ?? "", baseUrl).toString();
        } catch {
          /* ignore */
        }
      }
    } else if (line.startsWith("#EXT-X-KEY:")) {
      const method = /METHOD=([^,]+)/.exec(line)?.[1]?.trim() ?? "NONE";
      const m = /URI="([^"]+)"/.exec(line);
      if (m) {
        try {
          keys.push({ method, url: new URL(m[1] ?? "", baseUrl).toString() });
        } catch {
          /* ignore */
        }
      }
      if (method === "SAMPLE-AES") sampleAes = true;
    } else if (line.startsWith("#EXTINF:")) {
      durationSec += Number(line.slice(8).split(",")[0]) || 0;
      expectSegment = true;
    } else if (expectSegment) {
      expectSegment = false;
      if (line && !line.startsWith("#")) {
        try {
          segments.push(new URL(line, baseUrl).toString());
        } catch {
          /* ignore */
        }
      }
    }
  }
  return { segments, mapUrl, keys, durationSec, sampleAes };
}

/**
 * Rewrite a media playlist so every segment / init / key URI points at the
 * offline serve path. Bare URI lines and URI="..." attributes both handled;
 * already-offline URLs pass through untouched.
 */
export function rewritePlaylistForOffline(
  text: string,
  baseUrl: string
): string {
  const lines = text.split(/\r?\n/);
  let expectSegment = false;
  return lines
    .map((rawLine) => {
      const line = rawLine.trim();
      if (line.startsWith("#EXT-X-MAP:") || line.startsWith("#EXT-X-KEY:")) {
        return rawLine.replace(/URI="([^"]+)"/, (_m, uri: string) => {
          if (String(uri).startsWith("/api/dl?")) return `URI="${uri}"`;
          try {
            const abs = new URL(String(uri), baseUrl).toString();
            return `URI="${dlFileUrl(canonicalMediaKey(abs))}"`;
          } catch {
            return `URI="${uri}"`;
          }
        });
      }
      if (line.startsWith("#EXTINF:")) {
        expectSegment = true;
        return rawLine;
      }
      if (expectSegment) {
        expectSegment = false;
        if (line && !line.startsWith("#")) {
          if (line.startsWith("/api/dl?")) return rawLine;
          try {
            const abs = new URL(line, baseUrl).toString();
            return dlFileUrl(canonicalMediaKey(abs));
          } catch {
            return rawLine;
          }
        }
      }
      return rawLine;
    })
    .join("\n");
}

export function estimateBytes(bandwidth: number, durationSec: number): number {
  if (!bandwidth || !durationSec) return 0;
  return Math.round((bandwidth / 8) * durationSec);
}

/* ------------------------------------------------------------------ */
/* Separate-audio renditions (vix-style masters)                       */
/* ------------------------------------------------------------------ */

export type AudioEntry = {
  groupId: string;
  name: string;
  language: string;
  isDefault: boolean;
  url: string;
};

/** All TYPE=AUDIO EXT-X-MEDIA renditions in a master playlist. */
export function parseMasterAudio(text: string, baseUrl: string): AudioEntry[] {
  const out: AudioEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("#EXT-X-MEDIA:")) continue;
    if (!/TYPE=AUDIO/.test(line)) continue;
    const uri = /URI="([^"]+)"/.exec(line)?.[1];
    if (!uri) continue;
    try {
      out.push({
        groupId: /GROUP-ID="([^"]+)"/.exec(line)?.[1] ?? "",
        name: /NAME="([^"]+)"/.exec(line)?.[1] ?? "Audio",
        language: /LANGUAGE="([^"]+)"/.exec(line)?.[1] ?? "",
        isDefault: /DEFAULT=YES/.test(line),
        url: new URL(uri, baseUrl).toString(),
      });
    } catch {
      /* skip unresolvable URI */
    }
  }
  return out;
}

/** Prefer the user's audio language, else the source default, else first. */
export function pickAudioEntry(
  entries: AudioEntry[],
  wantLang: string,
  match: (lang: string | undefined, want: string) => boolean
): AudioEntry | null {
  if (entries.length === 0) return null;
  const group = entries;
  const byLang = group.find(
    (e) => match(e.language, wantLang) || match(e.name, wantLang)
  );
  if (byLang) return byLang;
  const def = group.find((e) => e.isDefault);
  if (def) return def;
  return group[0] ?? null;
}

/**
 * Minimal synthetic master pointing hls.js at the stored video + audio
 * playlists. Stream SUBTITLES groups are deliberately dropped — offline
 * subs come from the downloaded external VTT instead.
 */
export function buildOfflineMaster(opts: {
  variant: VariantInfo;
  videoPlaylistUrl: string;
  audio: AudioEntry | null;
  audioPlaylistUrl: string | null;
}): string {
  const res =
    opts.variant.width > 0 && opts.variant.height > 0
      ? `,RESOLUTION=${opts.variant.width}x${opts.variant.height}`
      : "";
  const codecs = opts.variant.codecs ? `,CODECS="${opts.variant.codecs}"` : "";
  const audioAttr =
    opts.audio && opts.audioPlaylistUrl ? `,AUDIO="offline-audio"` : "";
  const lines = ["#EXTM3U"];
  if (opts.audio && opts.audioPlaylistUrl) {
    lines.push(
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="offline-audio",NAME="${opts.audio.name}",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="${opts.audio.language || "und"}",URI="${opts.audioPlaylistUrl}"`
    );
  }
  lines.push(
    `#EXT-X-STREAM-INF:BANDWIDTH=${opts.variant.bandwidth}${res}${codecs}${audioAttr}`,
    opts.videoPlaylistUrl
  );
  return lines.join("\n");
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/* ------------------------------------------------------------------ */
/* Manifest store (IndexedDB, in-memory mirror for sync reads)         */
/* ------------------------------------------------------------------ */

let cache: Record<string, DownloadRecord> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastEmitAt = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* subscriber error must not break the engine */
    }
  }
}

export function subscribeDownloads(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function load(): Promise<Record<string, DownloadRecord>> {
  if (cache) return cache;
  try {
    cache = (await get<Record<string, DownloadRecord>>(MANIFEST_IDB_KEY)) ?? {};
  } catch {
    cache = {};
  }
  return cache;
}

function scheduleSave() {
  if (typeof window === "undefined") return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (cache) set(MANIFEST_IDB_KEY, cache).catch(() => {});
  }, 400);
}

export async function getManifest(): Promise<Record<string, DownloadRecord>> {
  const m = await load();
  return { ...m };
}

export function getRecordSync(key: string): DownloadRecord | null {
  return cache?.[key] ?? null;
}

export function getAllSync(): DownloadRecord[] {
  if (!cache) return [];
  return Object.values(cache).sort((a, b) => b.downloadedAt - a.downloadedAt);
}

export async function upsertRecord(rec: DownloadRecord): Promise<void> {
  const m = await load();
  m[rec.key] = rec;
  scheduleSave();
  emit();
}

/**
 * Progress-path update: writes through to the mirror immediately and emits
 * at most ~2×/s so progress rings don't re-render hundreds of times.
 */
export async function updateProgress(
  key: string,
  patch: Partial<DownloadRecord>
): Promise<void> {
  const m = await load();
  const rec = m[key];
  if (!rec) return;
  Object.assign(rec, patch);
  scheduleSave();
  const now = Date.now();
  if (now - lastEmitAt > 500) {
    lastEmitAt = now;
    emit();
  }
}

/** Flush a final state change immediately (done/error/paused). */
export async function commitRecord(rec: DownloadRecord): Promise<void> {
  const m = await load();
  m[rec.key] = rec;
  if (typeof window !== "undefined") {
    try {
      await set(MANIFEST_IDB_KEY, m);
    } catch {
      /* best-effort */
    }
  }
  emit();
}

export async function removeRecord(key: string): Promise<void> {
  const m = await load();
  delete m[key];
  scheduleSave();
  emit();
}

export async function touchRecord(key: string): Promise<void> {
  const m = await load();
  const rec = m[key];
  if (!rec) return;
  rec.lastUsedAt = Date.now();
  scheduleSave();
}

/* ------------------------------------------------------------------ */
/* Storage accounting                                                  */
/* ------------------------------------------------------------------ */

export async function storageStats(): Promise<{
  quota?: number;
  usage?: number;
  persisted: boolean;
}> {
  try {
    const est = await navigator.storage?.estimate?.();
    let persisted = false;
    try {
      persisted = (await navigator.storage?.persisted?.()) ?? false;
    } catch {
      /* ignore */
    }
    return { quota: est?.quota, usage: est?.usage, persisted };
  } catch {
    return { persisted: false };
  }
}

export async function ensurePersisted(): Promise<boolean> {
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Sum of finished-download bytes (the cap counts these). */
export function usedBytes(records: DownloadRecord[]): number {
  return records.reduce(
    (sum, r) => sum + (r.state === "done" ? r.sizeBytes : 0),
    0
  );
}

/** Delete every Cache Storage file owned by a record. */
export async function deleteRecordFiles(rec: DownloadRecord): Promise<void> {
  try {
    const c = await caches.open(DL_CACHE);
    await Promise.all(rec.fileUrls.map((u) => c.delete(u).catch(() => false)));
  } catch {
    /* cache unavailable — nothing to do */
  }
}

/**
 * True when the finished download's playlist bytes are still in the cache.
 * The OS may evict origin storage; call on settings-open and before offline
 * play to flip stale `done` rows to `missing`.
 */
export async function verifyRecordFiles(key: string): Promise<boolean> {
  const rec = getRecordSync(key) ?? (await load())[key];
  if (!rec || rec.state !== "done") return !!rec;
  try {
    const c = await caches.open(DL_CACHE);
    const hit = await c.match(dlPlaylistUrl(rec.key));
    if (!hit) {
      await upsertRecord({ ...rec, state: "missing" });
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* Offline resume positions (local only — server sync is a later phase) */
/* ------------------------------------------------------------------ */

/**
 * localStorage mirror of where offline playback stopped, per download key.
 * Shape is shared with public/offline.html (raw localStorage, same key):
 *   { [dlKey]: { pos: number; dur: number; at: number } }
 */
const OFFLINE_POS_LS_KEY = "tvtime-offline-positions";

export type OfflinePosition = { pos: number; dur: number; at: number };

function readPosMap(): Record<string, OfflinePosition> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(OFFLINE_POS_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, OfflinePosition>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Persist an offline stop position (throttle callers to ~2s). */
export function writeOfflinePosition(key: string, pos: number, dur: number): void {
  if (typeof window === "undefined") return;
  if (!key || !Number.isFinite(pos) || pos < 0) return;
  try {
    const map = readPosMap();
    map[key] = {
      pos,
      dur: Number.isFinite(dur) && dur > 0 ? dur : 0,
      at: Date.now(),
    };
    window.localStorage.setItem(OFFLINE_POS_LS_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable — resume just won't stick */
  }
}

export function readOfflinePosition(key: string): OfflinePosition | null {
  if (!key) return null;
  const entry = readPosMap()[key];
  if (!entry || !Number.isFinite(entry.pos) || entry.pos <= 0) return null;
  return entry;
}

export function clearOfflinePosition(key: string): void {
  if (typeof window === "undefined" || !key) return;
  try {
    const map = readPosMap();
    if (map[key]) {
      delete map[key];
      window.localStorage.setItem(OFFLINE_POS_LS_KEY, JSON.stringify(map));
    }
  } catch {
    /* ignore */
  }
}
