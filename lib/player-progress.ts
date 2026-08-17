import {
  MAX_PLAYBACK_SECONDS,
  RESUME_END_RATIO,
  RESUME_MIN_SECONDS,
  SAVE_MIN_DELTA_SECONDS,
  SAVE_THROTTLE_MS,
} from "@/lib/player-constants";

/**
 * True when `pos` is warmup noise before a resume seek lands (0–~5s reports
 * while HLS/startAt is still seeking to `pendingTarget`).
 * A real backward scrub (43:00 → 3:00) is NOT noise and must save.
 */
export function isPreSeekNoise(
  pos: number,
  pendingTarget: number | null | undefined,
  minSeconds = RESUME_MIN_SECONDS
): boolean {
  if (pendingTarget == null || !Number.isFinite(pendingTarget)) return false;
  if (!(pendingTarget > minSeconds)) return false;
  if (!Number.isFinite(pos)) return true;
  return pos < pendingTarget - 2 && pos <= minSeconds + 1;
}

/** True if a saved position is worth offering as Resume. */
export function isResumablePosition(
  pos: number,
  dur: number,
  endRatio = RESUME_END_RATIO,
  minSeconds = RESUME_MIN_SECONDS
): boolean {
  if (!Number.isFinite(pos) || pos <= minSeconds) return false;
  if (!Number.isFinite(dur) || dur <= 0) return true;
  return pos < dur * endRatio;
}

/** True once playback should count as finished (watched + clear bookmark). */
export function isFinishedPosition(
  pos: number,
  dur: number,
  endRatio = RESUME_END_RATIO
): boolean {
  if (!Number.isFinite(pos) || !Number.isFinite(dur) || dur <= 0) return false;
  return pos >= dur * endRatio;
}

/** True once host near-end UI (sticky Next) may fire. */
export function isNearEndPosition(
  pos: number,
  dur: number,
  nearRatio: number
): boolean {
  if (!Number.isFinite(pos) || !Number.isFinite(dur) || dur <= 0) return false;
  return pos >= dur * nearRatio;
}

export function clampPlaybackSeconds(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_PLAYBACK_SECONDS, n);
}

/**
 * Whether a progressive (non-force) save should run.
 * Force saves (pause/seek/close) always pass when pos is valid.
 */
export function shouldSaveProgress(opts: {
  pos: number;
  force: boolean;
  lastSavedPos: number;
  lastSavedAt: number;
  now?: number;
  throttleMs?: number;
  minDelta?: number;
}): boolean {
  const {
    pos,
    force,
    lastSavedPos,
    lastSavedAt,
    now = Date.now(),
    throttleMs = SAVE_THROTTLE_MS,
    minDelta = SAVE_MIN_DELTA_SECONDS,
  } = opts;
  if (!Number.isFinite(pos) || pos <= 0) return false;
  if (force) return true;
  if (now - lastSavedAt < throttleMs) return false;
  if (Math.abs(pos - lastSavedPos) < minDelta) return false;
  return true;
}

/** mm:ss or h:mm:ss for the transport scrubber. */
export function formatPlayerClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function makePlaybackKey(
  type: "movie" | "tv" | undefined,
  tmdbId: number | undefined,
  season: number | undefined,
  episode: number | undefined
): string | null {
  if (!type || tmdbId == null) return null;
  if (type === "tv") {
    if (season == null || episode == null) return null;
    return `type=tv&id=${tmdbId}&season=${season}&episode=${episode}`;
  }
  return `type=movie&id=${tmdbId}`;
}

export function addStartAt(src: string, position: number | null): string {
  if (position == null || !Number.isFinite(position) || position <= 0) return src;
  try {
    const url = new URL(src);
    url.searchParams.set("startAt", String(Math.floor(position)));
    return url.toString();
  } catch {
    return src;
  }
}
