/**
 * Persistent VixSrc native-player settings.
 *
 * Stored in localStorage so audio/subtitle/quality/speed/volume choices
 * survive player remounts (episode-to-episode) and app restarts.
 *
 * Schema is versioned: older builds saved hls.js-internal track switches
 * (e.g. auto-selected Italian subs) as if they were user choices. Bumping the
 * version discards that poisoned state.
 */

export type VixSettings = {
  /** Settings schema version — bump to invalidate old stored state. */
  v: number;
  /** Audio track language code, e.g. "en" | "it". */
  audio: string;
  /** Subtitle track language code, or "off". */
  subs: string | "off";
  /** Preferred video height: "auto" or e.g. 1080/720/480. */
  quality: "auto" | number;
  /** Playback rate multiplier. */
  speed: number;
  /** 0..1 */
  volume: number;
  muted: boolean;
  /** Auto-play the next episode when the current one ends (TV only). */
  autoplayNext: boolean;
};

export const VIX_SETTINGS_KEY = "vix-settings";

export const VIX_SETTINGS_VERSION = 2;

export const DEFAULT_VIX_SETTINGS: VixSettings = {
  v: VIX_SETTINGS_VERSION,
  audio: "en",
  subs: "en",
  quality: "auto",
  speed: 1,
  volume: 1,
  muted: false,
  autoplayNext: true,
};

/** Language codes that should NEVER apply as a default (hard user rule).
 *  Bidirectional includes() below covers ita/forced-ita variants. */
const BANNED_SUB_LANGS = ["it"];

function isBannedSubLang(lang: string | undefined | null): boolean {
  const l = (lang || "").toLowerCase();
  return BANNED_SUB_LANGS.some(
    (b) => l === b || l.includes(b) || b.includes(l)
  );
}

export function loadVixSettings(): VixSettings {
  const base = { ...DEFAULT_VIX_SETTINGS };
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(VIX_SETTINGS_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<VixSettings>;
    // Stale schema (pre-persistence-fix) — discard poisoned values entirely.
    if (parsed.v !== VIX_SETTINGS_VERSION) return base;
    const merged: VixSettings = { ...base, ...parsed };
    // Hard rule: Italian must never come back as a default.
    if (isBannedSubLang(merged.subs)) merged.subs = "en";
    if (isBannedSubLang(merged.audio)) merged.audio = "en";
    return merged;
  } catch {
    /* corrupt or unavailable storage — use defaults */
  }
  return base;
}

export function saveVixSettings(patch: Partial<VixSettings>) {
  if (typeof window === "undefined") return;
  try {
    const next = { ...loadVixSettings(), ...patch };
    // Never persist Italian (hard user rule) — clamp before storing so it
    // can't survive a session and become a default later.
    if (isBannedSubLang(next.subs)) next.subs = "en";
    if (isBannedSubLang(next.audio)) next.audio = "en";
    window.localStorage.setItem(VIX_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — persistence is best-effort */
  }
}

/** Loose language matcher: "en" matches "eng", "it" matches "ita"/"forced-ita". */
export function matchLang(lang: string | undefined, want: string): boolean {
  const l = (lang || "").toLowerCase();
  const w = want.toLowerCase();
  return l === w || l.includes(w) || w.includes(l);
}
