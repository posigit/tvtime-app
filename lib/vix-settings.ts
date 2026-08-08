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
  /**
   * Subtitle source preference (picker in the player):
   * "auto" (default) = stream CC when present, else VDRK → OpenSubtitles;
   * "off" = never show; "stream" = stream's own English CC only;
   * "vdrk" = force VDRK VTT; "opensub" = force OpenSubtitles VTT.
   */
  subSource: "auto" | "off" | "stream" | "vdrk" | "opensub";
  /** Last stream backend the user picked (Vix ↔ Goated). */
  preferredSource: "vix" | "goated";
  /**
   * Subtitle timing offset in seconds (positive = later). Applies to
   * injected VDRK/OpenSubtitles cues; stream-embedded CC is unaffected.
   */
  subDelaySeconds: number;
  /** Cue text size. */
  subFontSize: "sm" | "md" | "lg";
  /** Cue text color. */
  subColor: "white" | "yellow" | "cyan";
  /** Cue background opacity 0..1. */
  subBgOpacity: number;
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
  subSource: "auto",
  preferredSource: "vix",
  subDelaySeconds: 0,
  subFontSize: "md",
  subColor: "white",
  subBgOpacity: 0.35,
};

/** Language codes that should NEVER apply as a default (hard user rule).
 *  Bidirectional includes() below covers ita/forced-ita variants. */
const BANNED_SUB_LANGS = ["it"];

export function isBannedSubLang(lang: string | undefined | null): boolean {
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
    if (merged.preferredSource !== "vix" && merged.preferredSource !== "goated") {
      merged.preferredSource = "vix";
    }
    if (
      typeof merged.subDelaySeconds !== "number" ||
      !Number.isFinite(merged.subDelaySeconds)
    ) {
      merged.subDelaySeconds = 0;
    } else {
      merged.subDelaySeconds = Math.max(-10, Math.min(10, merged.subDelaySeconds));
    }
    if (
      merged.subFontSize !== "sm" &&
      merged.subFontSize !== "md" &&
      merged.subFontSize !== "lg"
    ) {
      merged.subFontSize = "md";
    }
    if (
      merged.subColor !== "white" &&
      merged.subColor !== "yellow" &&
      merged.subColor !== "cyan"
    ) {
      merged.subColor = "white";
    }
    if (
      typeof merged.subBgOpacity !== "number" ||
      !Number.isFinite(merged.subBgOpacity)
    ) {
      merged.subBgOpacity = 0.35;
    } else {
      merged.subBgOpacity = Math.max(0, Math.min(1, merged.subBgOpacity));
    }
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
    queueServerSync();
  } catch {
    /* storage unavailable — persistence is best-effort */
  }
}

/** Debounce window for server sync (ms). */
const SERVER_SYNC_DELAY = 800;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Fire-and-forget server sync of the current settings. Debounced so rapid
 * track/quality changes (multiple saveVixSettings calls per second) coalesce
 * into one POST. Never throws; unauthenticated/offline calls are no-ops.
 */
function queueServerSync() {
  if (typeof window === "undefined") return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    try {
      void fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: loadVixSettings() }),
      }).catch(() => {
        /* offline / 401 — localStorage still holds the value */
      });
    } catch {
      /* no-op */
    }
  }, SERVER_SYNC_DELAY);
}

/**
 * Pull server-side settings once per session and overwrite localStorage so
 * cross-device choices apply immediately. Called from the app Providers on
 * mount. Server is the source of truth across devices; localStorage is the
 * cache. No-op when unauthenticated (per-user data) or already hydrated.
 */
let hydrated = false;
export function hydrateVixSettings(): Promise<void> {
  if (typeof window === "undefined" || hydrated) return Promise.resolve();
  hydrated = true;
  return fetch("/api/settings")
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { settings?: Partial<VixSettings> } | null) => {
      if (!data?.settings) return;
      const merged = { ...DEFAULT_VIX_SETTINGS, ...data.settings };
      if (isBannedSubLang(merged.subs)) merged.subs = "en";
      if (isBannedSubLang(merged.audio)) merged.audio = "en";
      try {
        window.localStorage.setItem(
          VIX_SETTINGS_KEY,
          JSON.stringify({ ...merged, v: VIX_SETTINGS_VERSION })
        );
      } catch {
        /* storage unavailable — nothing to do */
      }
    })
    .catch(() => {
      /* network/auth failure — keep localStorage as-is */
    });
}

/** Loose language matcher: "en" matches "eng", "it" matches "ita"/"forced-ita". */
export function matchLang(lang: string | undefined, want: string): boolean {
  const l = (lang || "").toLowerCase();
  const w = want.toLowerCase();
  return l === w || l.includes(w) || w.includes(l);
}
