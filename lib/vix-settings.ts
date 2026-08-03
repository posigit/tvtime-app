/**
 * Persistent VixSrc native-player settings.
 *
 * Stored in localStorage so audio/subtitle/quality/speed/volume choices
 * survive player remounts (episode-to-episode) and app restarts.
 */

export type VixSettings = {
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
};

export const VIX_SETTINGS_KEY = "vix-settings";

export const DEFAULT_VIX_SETTINGS: VixSettings = {
  audio: "en",
  subs: "en",
  quality: "auto",
  speed: 1,
  volume: 1,
  muted: false,
};

export function loadVixSettings(): VixSettings {
  const base = { ...DEFAULT_VIX_SETTINGS };
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(VIX_SETTINGS_KEY);
    if (raw) return { ...base, ...(JSON.parse(raw) as Partial<VixSettings>) };
  } catch {
    /* corrupt or unavailable storage — use defaults */
  }
  return base;
}

export function saveVixSettings(patch: Partial<VixSettings>) {
  if (typeof window === "undefined") return;
  try {
    const next = { ...loadVixSettings(), ...patch };
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
