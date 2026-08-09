"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Captions, Check, Gauge, LoaderCircle, Lock, LockOpen, PictureInPicture2, Volume2, X } from "lucide-react";
import {
  isVixPlayerOrigin,
  parseVixPlayerEventData,
} from "@/lib/vixsrc";
import { ResumeOverlay } from "@/components/resume-overlay";
import { SubtitleOverlay } from "@/components/subtitle-overlay";
import { PlayerTransport } from "@/components/player-transport";
import { cn } from "@/lib/utils";
import {
  loadVixSettings,
  saveVixSettings,
  matchLang,
  type VixSettings,
} from "@/lib/vix-settings";
import {
  MAX_PLAYBACK_SECONDS,
  NEXT_FAB_RATIO,
  RESUME_MIN_SECONDS,
} from "@/lib/player-constants";
import {
  addStartAt,
  isFinishedPosition,
  isNearEndPosition,
  isResumablePosition,
  makePlaybackKey,
  shouldSaveProgress,
} from "@/lib/player-progress";

/** Safari-only audio-track API — not present in TS's DOM lib. */
type NativeAudioTrack = { language: string; enabled: boolean };
type NativeAudioTrackList = {
  length: number;
  [index: number]: NativeAudioTrack;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

const SUB_FONT_SCALE: Record<VixSettings["subFontSize"], number> = {
  sm: 1,
  md: 1.12,
  lg: 1.25, // +25%
};
const SUB_COLORS: Record<VixSettings["subColor"], string> = {
  white: "#ffffff",
  yellow: "#ffe566",
  cyan: "#7dd3fc",
};

// Keep playback mutations ordered across player remounts. A user can close
// and reopen the player before the previous keepalive request has completed.
let playbackRequestQueue: Promise<void> = Promise.resolve();

// Log a rejected iframe origin once per page load (not per message — spam).
let loggedRejectedOrigin = false;

function queuePlaybackRequest(params: string, init: RequestInit) {
  const request = playbackRequestQueue
    .catch(() => {})
    .then(() =>
      fetch(`/api/playback?${params}`, {
        ...init,
        credentials: "same-origin",
      })
    )
    .then(
      (res) => {
        if (!res.ok) {
          console.warn("[playback] save rejected", params, res.status);
        }
        return undefined;
      },
      (err) => {
        console.warn(
          "[playback] save request failed",
          params,
          err instanceof Error ? err.message : err
        );
        return undefined;
      }
    );
  playbackRequestQueue = request;
}

function waitForPlaybackRequests() {
  return playbackRequestQueue.catch(() => {});
}

function parseVttTime(t: string): number {
  const parts = t.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/** Keep cues active for SubtitleOverlay without native ::cue paint. */
function demoteShowingTracks(video: HTMLVideoElement) {
  const ttl = video.textTracks;
  for (let i = 0; i < ttl.length; i++) {
    const t = ttl[i];
    if (t.kind !== "subtitles" && t.kind !== "captions") continue;
    if (t.mode === "showing") t.mode = "hidden";
  }
}

/** Inject an external VTT as a native text track (shows in the CC menu). */
function injectVttTrack(
  video: HTMLVideoElement,
  vtt: string,
  label: string,
  show: boolean,
  delaySeconds = 0
): TextTrack | null {
  const track = video.addTextTrack("subtitles", label, "en");
  // Always "hidden": we draw cues ourselves via SubtitleOverlay (::cue is unreliable).
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

/**
 * Fetch an external VTT (VDRK or OpenSubtitles) for the current item.
 * Returns { vtt, label } or null. Shared by the hls.js and Safari paths.
 */
async function fetchExternalVtt(opts: {
  source: "vdrk" | "opensub";
  type?: "movie" | "tv";
  tmdbId?: number;
  season?: number;
  episode?: number;
  imdbId?: string | null;
}): Promise<{ vtt: string; label: string } | null> {
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
      // VDRK returns 200 with an empty body for titles it lacks.
      if (vtt.trim().length === 0) return null;
      return { vtt, label: "English (VDRK)" };
    } catch {
      return null;
    }
  }

  // opensub
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

/**
 * Full-screen VixSrc player overlay.
 *
 * Primary path: resolves the stream through /api/vixsrc/stream and plays the
 * HLS master playlist natively with hls.js — no iframe, so Cloudflare's
 * iframe challenge and *.vercel.app referer block never apply.
 *
 * Fallback: if the stream route fails (or native playback errors), falls back
 * to the signed iframe embed (src) and forwards its postMessage events.
 *
 * Events (both paths): play / pause / seeked / ended / timeupdate.
 */
export function VixPlayer({
  src,
  title,
  onEvent,
  onClose,
  onNearEnd,
  type,
  tmdbId,
  season,
  episode,
  initialPosition,
  autoResume = false,
  source = "vix",
}: {
  src: string;
  title: string;
  onEvent?: (event: string) => void;
  onClose: () => void;
  /** Fires once when playback reaches ~96% (sticky Next FAB gate). */
  onNearEnd?: () => void;
  type?: "movie" | "tv";
  tmdbId?: number;
  season?: number;
  episode?: number;
  /** Position supplied by a Continue Watching/detail CTA. */
  initialPosition?: number;
  /** Seek directly to initialPosition instead of showing the prompt. */
  autoResume?: boolean;
  /** Stream backend: "vix" (default) or "goated". */
  source?: "vix" | "goated";
}) {
  const initialPlaybackKey = makePlaybackKey(type, tmdbId, season, episode);
  const initialResumePosition =
    autoResume &&
    initialPosition != null &&
    Number.isFinite(initialPosition) &&
    initialPosition > 5
      ? Math.min(MAX_PLAYBACK_SECONDS, initialPosition)
      : null;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  /** Fullscreen this shell (not <video>) so SubtitleOverlay + chrome stay visible. */
  const shellRef = useRef<HTMLDivElement>(null);
  const imdbIdRef = useRef<string | null>(null);
  const lastSavedPosRef = useRef(0);
  const lastSavedAtRef = useRef(0);
  const onEventRef = useRef(onEvent);
  const onCloseRef = useRef(onClose);
  const onNearEndRef = useRef(onNearEnd);
  const endedRef = useRef(false);
  const nearEndFiredRef = useRef(false);
  const lastTimeRef = useRef(0);
  const remotePositionRef = useRef(0);
  const remoteDurationRef = useRef(0);
  const bookmarkClearedRef = useRef(false);
  /** Blocks progress writes until resume check (and optional prompt) finishes. */
  const saveEnabledRef = useRef(false);
  /** While true, keep the video paused under the resume overlay. */
  const holdForResumeRef = useRef(false);
  /**
   * Key of the episode the resume lookup has already run for. The lookup is a
   * per-episode fact — running it again on mode flips (source switches flip
   * native→loading→native) re-arms the hold and re-pops the overlay mid-play.
   */
  const resumeLookupDoneRef = useRef<string | null>(null);
  const resumePosRef = useRef(initialResumePosition ?? 0);
  /** Seek here after a Vix↔Goated switch once the new playlist is ready. */
  const switchRestorePosRef = useRef<number | null>(null);

  const streamable = type === "movie" || type === "tv";
  // Source backend — prefer last user choice, then prop default.
  const [activeSource, setActiveSource] = useState<"vix" | "goated">(
    () => loadVixSettings().preferredSource || source
  );
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null);
  // Non-streamable mounts (no type/tmdbId) go straight to iframe fallback.
  const [streamFailed, setStreamFailed] = useState(() => !streamable);
  const [iframeError, setIframeError] = useState(false);
  const [resumePosition, setResumePosition] = useState<number | null>(
    initialResumePosition
  );
  const [resumeKey, setResumeKey] = useState<string | null>(
    initialResumePosition != null ? initialPlaybackKey : null
  );
  const [locked, setLocked] = useState(false);
  /** Custom chrome only — native <video controls> are off (dual-layer fix). */
  const [chromeVisible, setChromeVisible] = useState(true);
  const [transport, setTransport] = useState({
    currentTime: 0,
    duration: 0,
    paused: true,
    muted: false,
    volume: 1,
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const chromeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Blocks synthetic mouse click after touch chrome toggle. */
  const lastTouchChromeRef = useRef(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(
    () => loadVixSettings().speed
  );
  const [subDelay, setSubDelay] = useState(
    () => loadVixSettings().subDelaySeconds
  );
  const [subFontSize, setSubFontSize] = useState<VixSettings["subFontSize"]>(
    () => loadVixSettings().subFontSize
  );
  const [subColor, setSubColor] = useState<VixSettings["subColor"]>(
    () => loadVixSettings().subColor
  );
  const [subBgOpacity, setSubBgOpacity] = useState(
    () => loadVixSettings().subBgOpacity
  );
  /** True once an external VTT is loaded — Sync can re-time it. */
  const [hasExternalSubs, setHasExternalSubs] = useState(false);
  const [audioTracks, setAudioTracks] = useState<
    { id: number; lang: string; name: string }[]
  >([]);
  const [audioTrackId, setAudioTrackId] = useState<number>(-1);
  const setHlsAudioTrackRef = useRef<((id: number) => void) | null>(null);
  const [qualityLevels, setQualityLevels] = useState<
    { height: number; index: number }[]
  >([]);
  const [qualitySelection, setQualitySelection] = useState<"auto" | number>(
    () => loadVixSettings().quality
  );
  const setHlsQualityRef = useRef<((next: "auto" | number) => void) | null>(
    null
  );
  const [subSource, setSubSource] = useState<"auto" | "off" | "stream" | "vdrk" | "opensub">(
    () => {
      const s = loadVixSettings();
      // Repair bootstrap poison: Auto/stream/external must not keep subs:"off".
      if (s.subSource !== "off" && s.subs === "off") {
        saveVixSettings({ subs: "en" });
      }
      return s.subSource;
    }
  );
  /** Latest subSource for async closures inside the native-playback effect. */
  const subSourceRef = useRef(subSource);
  useEffect(() => {
    subSourceRef.current = subSource;
  }, [subSource]);
  /** Externally injected VTT tracks (VDRK / OpenSubtitles) so we can hide them. */
  const injectedTracksRef = useRef<TextTrack[]>([]);
  /** Last fetched external VTT — re-used when adjusting sync delay (no re-fetch). */
  const externalVttRef = useRef<{ vtt: string; label: string } | null>(null);
  /** Set by the native effect; lets the picker re-run subtitle loading. */
  const reloadSubsRef = useRef<(() => void) | null>(null);
  /** Re-inject cached VTT with current delay only. */
  const reapplyExternalSubsRef = useRef<(() => void) | null>(null);
  /** Safari forced-source delayed load handle (cleared on unmount). */
  // window.setTimeout returns number (DOM); bare setTimeout returns Timeout
  // (Node). We call window.setTimeout, so the ref is number.
  const safariTimerRef = useRef<number | null>(null);
  const [tapCue, setTapCue] = useState<{ side: "left" | "right" } | null>(
    null
  );
  const [subMenuOpen, setSubMenuOpen] = useState(false);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  /** Surface external-subtitle fetch failures instead of stranding the picker. */
  const [subError, setSubError] = useState<string | null>(null);
  const subMenuRef = useRef<HTMLDivElement>(null);
  const audioMenuRef = useRef<HTMLDivElement>(null);
  const qualityMenuRef = useRef<HTMLDivElement>(null);
  // ProfileMenu-style outside dismiss for CC + audio + quality menus.
  useEffect(() => {
    if (!subMenuOpen && !audioMenuOpen && !qualityMenuOpen) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const node = e.target as Node | null;
      if (subMenuOpen && subMenuRef.current && node && !subMenuRef.current.contains(node)) {
        setSubMenuOpen(false);
      }
      if (audioMenuOpen && audioMenuRef.current && node && !audioMenuRef.current.contains(node)) {
        setAudioMenuOpen(false);
      }
      if (qualityMenuOpen && qualityMenuRef.current && node && !qualityMenuRef.current.contains(node)) {
        setQualityMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setSubMenuOpen(false);
        setAudioMenuOpen(false);
        setQualityMenuOpen(false);
      }
    };
    const onScroll = () => {
      setSubMenuOpen(false);
      setAudioMenuOpen(false);
      setQualityMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer, { passive: true });
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll);
    };
  }, [subMenuOpen, audioMenuOpen, qualityMenuOpen]);
  const lastTapRef = useRef<{ time: number; side: "left" | "right" } | null>(
    null
  );
  const tapCueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // mode: native -> iframe -> error
  const mode = streamFailed
    ? iframeError
      ? "error"
      : "iframe"
    : playlistUrl
      ? "native"
      : "loading";

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onNearEndRef.current = onNearEnd;
  }, [onNearEnd]);

  useEffect(() => {
    endedRef.current = false;
    lastTimeRef.current = 0;
    lastSavedPosRef.current = 0;
    lastSavedAtRef.current = 0;
    remotePositionRef.current = 0;
    remoteDurationRef.current = 0;
    bookmarkClearedRef.current = false;
    lastTapRef.current = null;
    if (tapCueTimerRef.current) {
      clearTimeout(tapCueTimerRef.current);
      tapCueTimerRef.current = null;
    }
    if (tapCueTimerRef.current) clearTimeout(tapCueTimerRef.current);
  }, [src]);

  const emit = useCallback((event: string) => {
    if (event === "ended") {
      if (endedRef.current) return;
      endedRef.current = true;
    }
    onEventRef.current?.(event);
  }, []);

  // ---------- resume playback ----------

  // Build from props (not a post-stream ref) so progress saves still work if
  // the stream route fails and we fall back to the iframe.
  const playbackParams = useCallback(() => {
    return makePlaybackKey(type, tmdbId, season, episode);
  }, [type, tmdbId, season, episode]);

  const enqueuePlaybackRequest = useCallback(
    (params: string, init: RequestInit) => {
      queuePlaybackRequest(params, init);
    },
    []
  );

  const savePosition = useCallback(
    (pos: number, duration: number, force = false) => {
      if (!saveEnabledRef.current || endedRef.current) return;
      const params = playbackParams();
      if (!params) return;
      if (!Number.isFinite(pos) || pos <= 0) return;
      const position = Math.min(MAX_PLAYBACK_SECONDS, pos);
      if (!Number.isFinite(position) || position <= 0) return;
      // Near the end (92%): drop the bookmark instead of thrashing writes.
      const dur =
        Number.isFinite(duration) && duration > 0
          ? Math.min(MAX_PLAYBACK_SECONDS, duration)
          : 0;
      if (isFinishedPosition(position, dur)) {
        if (!bookmarkClearedRef.current) {
          bookmarkClearedRef.current = true;
          lastSavedPosRef.current = 0;
          enqueuePlaybackRequest(params, {
            method: "DELETE",
            keepalive: true,
          });
        }
        return;
      }
      bookmarkClearedRef.current = false;
      const now = Date.now();
      if (
        !shouldSaveProgress({
          pos: position,
          force,
          lastSavedPos: lastSavedPosRef.current,
          lastSavedAt: lastSavedAtRef.current,
          now,
        })
      ) {
        return;
      }
      lastSavedPosRef.current = position;
      lastSavedAtRef.current = now;
      enqueuePlaybackRequest(params, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positionSeconds: position,
          durationSeconds: dur,
        }),
        keepalive: true, // survives close/unmount
      });
    },
    [enqueuePlaybackRequest, playbackParams]
  );

  const clearPosition = useCallback(() => {
    const params = playbackParams();
    if (!params) return;
    bookmarkClearedRef.current = true;
    enqueuePlaybackRequest(params, {
      method: "DELETE",
      keepalive: true,
    });
  }, [enqueuePlaybackRequest, playbackParams]);

  const seekVideo = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(t)) return;

    let attempts = 0;
    const retry = () => {
      if (attempts++ >= 20 || videoRef.current !== v) return;
      window.setTimeout(doSeek, 250);
    };
    const doSeek = () => {
      if (videoRef.current !== v) return;
      if (v.readyState < 1) {
        retry();
        return;
      }
      const duration = Number.isFinite(v.duration) && v.duration > 0
        ? v.duration
        : null;
      const target = Math.min(Math.max(0, t), duration ?? t);
      try {
        v.currentTime = target;
      } catch {
        retry();
        return;
      }
      if (!Number.isFinite(v.currentTime) || Math.abs(v.currentTime - target) > 1) {
        retry();
        return;
      }
      void v.play().catch(() => {});
    };
    doSeek();
  }, []);

  /** Native-mode ±10s seek, with a transient on-screen cue. */
  const seekBy = useCallback(
    (side: "left" | "right") => {
      const v = videoRef.current;
      const delta = side === "right" ? 10 : -10;
      if (!v || mode !== "native" || !Number.isFinite(v.currentTime)) return;
      const target = Math.max(0, v.currentTime + delta);
      const dur =
        Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
      v.currentTime = dur == null ? target : Math.min(target, dur);
      setTapCue({ side });
      if (tapCueTimerRef.current) clearTimeout(tapCueTimerRef.current);
      tapCueTimerRef.current = setTimeout(() => setTapCue(null), 650);
    },
    [mode]
  );

  const bumpChrome = useCallback(() => {
    if (locked) return;
    setChromeVisible(true);
    if (chromeHideTimerRef.current) clearTimeout(chromeHideTimerRef.current);
    const v = videoRef.current;
    // Auto-hide only while playing and no menus are open.
    if (v && !v.paused) {
      chromeHideTimerRef.current = setTimeout(() => {
        if (!subMenuOpen && !audioMenuOpen && !qualityMenuOpen) {
          setChromeVisible(false);
        }
      }, 3200);
    }
  }, [locked, subMenuOpen, audioMenuOpen, qualityMenuOpen]);

  /** Double-tap ±10s; single tap toggles custom chrome (no native controls). */
  const handleTap = useCallback(
    (e: React.TouchEvent) => {
      if (mode !== "native" || locked) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const side: "left" | "right" =
        t.clientX < rect.left + rect.width / 2 ? "left" : "right";
      const now = performance.now();
      const prev = lastTapRef.current;
      if (prev && prev.side === side && now - prev.time <= 350) {
        lastTapRef.current = null;
        seekBy(side);
        bumpChrome();
      } else {
        lastTapRef.current = { time: now, side };
        // Defer single-tap chrome toggle so a double-tap can cancel it.
        window.setTimeout(() => {
          if (lastTapRef.current?.time === now) {
            lastTouchChromeRef.current = performance.now();
            setChromeVisible((v) => !v);
            if (!videoRef.current?.paused) bumpChrome();
          }
        }, 360);
      }
    },
    [mode, locked, seekBy, bumpChrome]
  );

  const handleVideoClick = useCallback(
    (e: React.MouseEvent) => {
      if (mode !== "native" || locked) return;
      // Ignore the synthetic click that follows touchend on mobile.
      if (performance.now() - lastTouchChromeRef.current < 500) return;
      // Ignore clicks that originate from chrome buttons (they stopPropagation).
      if ((e.target as HTMLElement).closest("button, input, [role='menu']")) {
        return;
      }
      setChromeVisible((v) => !v);
      bumpChrome();
    },
    [mode, locked, bumpChrome]
  );

  const releaseResumeHold = useCallback(() => {
    holdForResumeRef.current = false;
    saveEnabledRef.current = true;
    setResumeKey(null);
    setResumePosition(null);
  }, []);

  const handleResume = useCallback(() => {
    const pos = resumePosRef.current || resumePosition || 0;
    releaseResumeHold();
    if (pos > 0) {
      bookmarkClearedRef.current = false;
      lastSavedPosRef.current = pos;
      lastSavedAtRef.current = Date.now();
      seekVideo(pos);
    }
  }, [resumePosition, releaseResumeHold, seekVideo]);

  const handleRestart = useCallback(() => {
    clearPosition();
    endedRef.current = false;
    lastSavedPosRef.current = 0;
    releaseResumeHold();
    seekVideo(0);
  }, [clearPosition, releaseResumeHold, seekVideo]);

  // Fetch saved position before native playback starts. Block saves and pause
  // autoplay until this resolves so playback cannot start at 0 or wipe a good
  // bookmark while the lookup is pending.
  useEffect(() => {
    const params = playbackParams();
    if (!params) return;
    if (mode === "iframe") {
      // No cross-origin seek API for the embed — resume via its startAt
      // param instead. Keep saves disabled until the lookup completes so an
      // iframe's initial 0–5s reports cannot overwrite a real bookmark.
      holdForResumeRef.current = false;
      if (initialResumePosition == null) {
        saveEnabledRef.current = false;
        let cancelled = false;
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 8_000);
        waitForPlaybackRequests()
          .then(() =>
            cancelled
              ? null
              : fetch(`/api/playback?${params}`, { signal: controller.signal })
          )
          .then((r) => (r?.ok ? r.json() : null))
          .then(
            (
              data: { positionSeconds?: number; durationSeconds?: number } | null
            ) => {
              if (cancelled) return;
              const pos =
                typeof data?.positionSeconds === "number" &&
                Number.isFinite(data.positionSeconds)
                  ? Math.max(0, data.positionSeconds)
                  : 0;
              const dur =
                typeof data?.durationSeconds === "number" &&
                Number.isFinite(data.durationSeconds)
                  ? Math.max(0, data.durationSeconds)
                  : 0;
              if (isResumablePosition(pos, dur)) {
                resumePosRef.current = pos;
                setResumePosition(pos);
                // The state update remounts the iframe with startAt. The
                // resume gate above protects it until the embed reaches pos.
                saveEnabledRef.current = true;
              } else {
                saveEnabledRef.current = true;
              }
            }
          )
          .catch(() => {
            if (!cancelled) saveEnabledRef.current = true;
          })
          .finally(() => window.clearTimeout(timeout));
        return () => {
          cancelled = true;
          controller.abort();
          window.clearTimeout(timeout);
        };
      }
      return;
    }
    if (mode !== "native") return;

    // The resume lookup is a per-episode fact. A source switch flips mode
    // (native→loading→native), which re-runs this effect — without this guard
    // it re-arms the hold and re-pops the Resume overlay mid-playback, which
    // freezes the timer and makes the video look like it restarted.
    if (resumeLookupDoneRef.current === params) return;
    // NOTE: the ref is set on COMPLETION (non-cancelled paths below), NOT
    // here — setting it eagerly would let a source switch that lands
    // mid-lookup abort the fetch, skip the re-run, and deadlock the video
    // paused with the hold armed and no overlay to escape through.

    saveEnabledRef.current = false;
    holdForResumeRef.current = true;
    const suppliedPosition =
      autoResume &&
      initialResumePosition != null &&
      initialPlaybackKey === params
        ? initialResumePosition
        : null;
    resumePosRef.current = suppliedPosition ?? 0;
    videoRef.current?.pause();

    if (suppliedPosition != null) {
      resumeLookupDoneRef.current = params;
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    const finishWithoutResume = () => {
      if (cancelled) return;
      resumeLookupDoneRef.current = params;
      resumePosRef.current = 0;
      setResumeKey(null);
      setResumePosition(null);
      holdForResumeRef.current = false;
      saveEnabledRef.current = true;
      void videoRef.current?.play().catch(() => {});
    };

    waitForPlaybackRequests()
      .then(() => {
        if (cancelled) return null;
        return fetch(`/api/playback?${params}`, { signal: controller.signal });
      })
      .then((r) => (r?.ok ? r.json() : null))
      .then(
        (
          data: { positionSeconds?: number; durationSeconds?: number } | null
        ) => {
          if (cancelled) return;
          const pos =
            typeof data?.positionSeconds === "number" &&
            Number.isFinite(data.positionSeconds)
              ? Math.max(0, data.positionSeconds)
              : 0;
          const dur =
            typeof data?.durationSeconds === "number" &&
            Number.isFinite(data.durationSeconds)
              ? Math.max(0, data.durationSeconds)
              : 0;
          // Resume only if meaningfully mid-way; near-complete counts as done.
          if (isResumablePosition(pos, dur)) {
            resumeLookupDoneRef.current = params;
            resumePosRef.current = pos;
            setResumeKey(params);
            holdForResumeRef.current = true;
            setResumePosition(pos);
            // Keep saveEnabled false until Resume/Restart.
            return;
          }
          // Stale near-end bookmark — clear so the next open starts clean.
          if (isFinishedPosition(pos, dur)) {
            clearPosition();
          }
          finishWithoutResume();
        }
      )
      .catch(finishWithoutResume)
      .finally(() => window.clearTimeout(timeout));
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
      // If the lookup was aborted mid-flight (source switch landed in the
      // window), it never set resumeLookupDoneRef — release the hold so the
      // video can't deadlock paused. Completed lookups manage their own hold
      // (the resume overlay keeps it armed until Resume/Restart).
      if (resumeLookupDoneRef.current !== params) {
        holdForResumeRef.current = false;
        saveEnabledRef.current = true;
      }
    };
  }, [
    autoResume,
    clearPosition,
    initialPlaybackKey,
    initialResumePosition,
    mode,
    playbackParams,
  ]);

  // Keep native playback paused while the resume lookup or prompt is active.
  useEffect(() => {
    if (mode !== "native") return;
    const v = videoRef.current;
    if (!v) return;
    const hold = () => {
      if (holdForResumeRef.current) v.pause();
    };
    hold();
    v.addEventListener("play", hold);
    v.addEventListener("loadedmetadata", hold);
    return () => {
      v.removeEventListener("play", hold);
      v.removeEventListener("loadedmetadata", hold);
    };
  }, [mode, playlistUrl]);

  // A Continue Watching CTA supplies the position, so seek directly without
  // putting a second confirmation prompt in front of the user.
  useEffect(() => {
    if (
      !autoResume ||
      mode !== "native" ||
      resumePosition == null ||
      resumeKey !== playbackParams()
    ) {
      return;
    }
    const position = resumePosition;
    holdForResumeRef.current = false;
    saveEnabledRef.current = true;
    lastSavedPosRef.current = position;
    lastSavedAtRef.current = Date.now();
    seekVideo(position);
  }, [
    autoResume,
    mode,
    playbackParams,
    resumeKey,
    resumePosition,
    seekVideo,
  ]);

  // Iframe path: no seek API for the embed, so drop any resume prompt and
  // still allow progress saves for the next native session.
  useEffect(() => {
    if (mode !== "iframe") return;
    holdForResumeRef.current = false;
    // With no supplied position, the lookup effect owns this gate until it
    // has either found a bookmark or confirmed there is none.
    saveEnabledRef.current =
      initialResumePosition != null || resumePosition != null;
  }, [initialResumePosition, mode, resumePosition]);

  // ---------- source switching ----------
  const switchSource = useCallback((next: "vix" | "goated") => {
    if (next === activeSource) return;
    const v = videoRef.current;
    const pos =
      v && Number.isFinite(v.currentTime) && v.currentTime > RESUME_MIN_SECONDS
        ? v.currentTime
        : lastSavedPosRef.current > RESUME_MIN_SECONDS
          ? lastSavedPosRef.current
          : remotePositionRef.current > RESUME_MIN_SECONDS
            ? remotePositionRef.current
            : null;
    if (pos != null) switchRestorePosRef.current = pos;
    saveVixSettings({ preferredSource: next });
    setActiveSource(next);
    // Reset playback state so the resolution effect re-runs fresh.
    setPlaylistUrl(null);
    setStreamFailed(false);
    setIframeError(false);
    setAudioTracks([]);
    setAudioTrackId(-1);
    setQualityLevels([]);
    // Keep ended/nearEnd so binge overlays don't double-fire after a switch.
    bookmarkClearedRef.current = false;
    lastSavedPosRef.current = 0;
    lastSavedAtRef.current = 0;
  }, [activeSource]);

  /** Subtitle source picker: persist choice + re-run the subtitle loader. */
  const handleSubSource = useCallback(
    (next: "auto" | "off" | "stream" | "vdrk" | "opensub") => {
      setSubSource(next);
      // Sync the ref synchronously so the immediate reload reads the NEW
      // source (passive useEffect would run only after the commit).
      subSourceRef.current = next;
      setSubMenuOpen(false);
      setSubError(null);
      // subs mirrors the source so applySettings() can drive off/stream
      // (subs === "off" hides; otherwise the language preference applies).
      saveVixSettings({
        subSource: next,
        subs: next === "off" ? "off" : "en",
      });
      reloadSubsRef.current?.();
    },
    []
  );

  /**
   * Revert the picker to "auto" when a forced external source (VDRK /
   * OpenSubtitles) fails to load. Without this the checkmark strands on a
   * dead source and the user sees no subs and no error. Re-run Auto load so
   * stream/VDRK/OS cascade actually applies after the revert.
   */
  const revertExternalSub = useCallback((failed: "vdrk" | "opensub") => {
    subSourceRef.current = "auto";
    setSubSource("auto");
    setSubError(
      `${failed === "vdrk" ? "VDRK" : "OpenSubtitles"} subtitles unavailable — switched to Auto`
    );
    saveVixSettings({ subSource: "auto", subs: "en" });
    queueMicrotask(() => reloadSubsRef.current?.());
  }, []);

  // ---------- resolve native stream (single fetch, single source of truth) ----------
  useEffect(() => {
    if (!streamable || !tmdbId) return; // initial state already fell back
    let cancelled = false;
    const params = new URLSearchParams({ type: type!, id: String(tmdbId) });
    if (season != null) params.set("season", String(season));
    if (episode != null) params.set("episode", String(episode));

    const isGoated = activeSource === "goated";
    // goated resolves to a signed master URL; the browser must play it through
    // the media proxy (referer/origin-locked upstream). vixsrc playlists are
    // CORS-open so the browser fetches them directly.
    fetch(`${isGoated ? "/api/goated/stream" : "/api/vixsrc/stream"}?${params.toString()}`)
      .then((res) => {
        if (!res.ok) {
          return res
            .text()
            .then(
              (text) =>
                Promise.reject(
                  new Error(`stream route ${res.status}: ${text.slice(0, 200)}`)
                )
            );
        }
        return res.json();
      })
      .then((data: { url?: string; playlistUrl?: string; imdbId?: string | null }) => {
        if (cancelled) return;
        imdbIdRef.current = data?.imdbId ?? null;
        const direct = data?.playlistUrl;
        const signed = data?.url;
        if (direct) {
          setPlaylistUrl(direct);
          return;
        }
        if (signed) {
          // Route the locked upstream through our same-origin proxy.
          setPlaylistUrl(`/api/goated/media?url=${encodeURIComponent(signed)}`);
          return;
        }
        setStreamFailed(true);
      })
      .catch((err) => {
        console.warn(
          `[player] ${activeSource} stream resolution failed — falling back to iframe:`,
          err instanceof Error ? err.message : err
        );
        if (!cancelled) setStreamFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [streamable, type, tmdbId, season, episode, activeSource]);

  // ---------- native playback (hls.js / Safari native) ----------
  useEffect(() => {
    if (mode !== "native" || !playlistUrl || !videoRef.current) return;
    const video = videoRef.current;
    let hls: Hls | null = null;
    const cleanup: Array<() => void> = [];
    let bootstrapTimer: number | null = null;

    if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(playlistUrl);
      hls.attachMedia(video);

      // hls.js populates audio/subtitle tracks AFTER MANIFEST_PARSED (lazy).
      // So: try on every track-population event, but only until the user
      // makes a live choice (userTouched) so we never stomp their selection.
      let userTouched = false;
      let everApplied = false;
      let applying = false;
      let bootstrapDone = false;
      /** Apply volume/mute once — re-applying muted:true after user unmute was killing audio. */
      let avPrimed = false;
      bootstrapTimer = window.setTimeout(() => {
        bootstrapDone = true;
      }, 2500);

      const syncAudioMenu = () => {
        if (!hls) return;
        setAudioTracks(
          hls.audioTracks.map((t) => ({
            id: t.id,
            lang: t.lang || "",
            name: t.name || t.lang || `Audio ${t.id}`,
          }))
        );
        setAudioTrackId(hls.audioTrack);
      };

      const syncQualityMenu = () => {
        if (!hls) return;
        const seen = new Set<number>();
        const levels: { height: number; index: number }[] = [];
        hls.levels.forEach((lv, index) => {
          const h = lv.height || 0;
          if (h > 0 && !seen.has(h)) {
            seen.add(h);
            levels.push({ height: h, index });
          }
        });
        levels.sort((a, b) => b.height - a.height);
        setQualityLevels(levels);
      };

      setHlsAudioTrackRef.current = (id: number) => {
        if (!hls) return;
        applying = true;
        userTouched = true;
        hls.audioTrack = id;
        applying = false;
        const t = hls.audioTracks.find((x) => x.id === id);
        if (t?.lang) saveVixSettings({ audio: t.lang });
        setAudioTrackId(id);
      };

      setHlsQualityRef.current = (next: "auto" | number) => {
        if (!hls) return;
        applying = true;
        if (next === "auto") {
          hls.currentLevel = -1;
          hls.loadLevel = -1;
        } else {
          const li = hls.levels.findIndex((lv) => lv.height === next);
          if (li >= 0) {
            hls.currentLevel = li;
            hls.loadLevel = li;
          }
        }
        applying = false;
        setQualitySelection(next);
        saveVixSettings({ quality: next });
      };

      const applySettings = () => {
        if (!hls) return;
        const s = loadVixSettings();
        // Keep Auto/source prefs from being stuck on poisoned subs:"off".
        if (subSourceRef.current !== "off" && s.subs === "off") {
          saveVixSettings({ subs: "en" });
          s.subs = "en";
        }

        const at = hls.audioTracks.find((t) => matchLang(t.lang, s.audio));
        if (at && hls.audioTrack !== at.id) {
          applying = true;
          hls.audioTrack = at.id;
          applying = false;
        }

        hls.subtitleDisplay = false; // we render via SubtitleOverlay, not native ::cue
        // Forced external modes (vdrk/opensub) own the subtitle surface: never
        // re-enable the stream's CC track here — the injected track is the one.
        const forcedExternal = subSourceRef.current === "vdrk" || subSourceRef.current === "opensub";
        const externalActive = injectedTracksRef.current.some(
          (t) => t.mode !== "disabled"
        );
        if (forcedExternal || (subSourceRef.current === "auto" && externalActive)) {
          if (hls.subtitleTrack !== -1) {
            applying = true;
            hls.subtitleTrack = -1;
            applying = false;
          }
        } else if (s.subs === "off" || subSourceRef.current === "off") {
          if (hls.subtitleTrack !== -1) {
            applying = true;
            hls.subtitleTrack = -1;
            applying = false;
          }
        } else {
          const st = hls.subtitleTracks.find((t) =>
            matchLang(t.lang, s.subs)
          );
          if (st) {
            if (hls.subtitleTrack !== st.id) {
              applying = true;
              hls.subtitleTrack = st.id;
              applying = false;
            }
          } else if (hls.subtitleTrack !== -1) {
            applying = true;
            hls.subtitleTrack = -1;
            applying = false;
          }
        }
        // Keep tracks "hidden" so cues fire without native double-draw.
        demoteShowingTracks(video);

        if (s.quality === "auto") {
          if (hls.currentLevel !== -1) {
            applying = true;
            hls.currentLevel = -1;
            hls.loadLevel = -1;
            applying = false;
          }
          setQualitySelection("auto");
        } else if (typeof s.quality === "number") {
          const li = hls.levels.findIndex((lv) => lv.height === s.quality);
          if (li >= 0 && hls.currentLevel !== li) {
            applying = true;
            hls.currentLevel = li;
            hls.loadLevel = li;
            applying = false;
          }
          setQualitySelection(s.quality);
        }

        video.playbackRate = s.speed;
        // Volume once; always start unmuted (mute is session-only, never restored).
        if (!avPrimed) {
          video.volume = s.volume;
          video.muted = false;
          avPrimed = true;
        }
        // Only counts as "applied" once subtitle tracks exist — audio-only
        // must not open the door for SUBTITLE_TRACK_SWITCH poison.
        if (hls.subtitleTracks.length > 0) {
          everApplied = true;
        }
        syncAudioMenu();
        syncQualityMenu();
      };

      const restoreSwitchPos = () => {
        const pos = switchRestorePosRef.current;
        if (pos == null || !Number.isFinite(pos) || pos <= RESUME_MIN_SECONDS) {
          return;
        }
        switchRestorePosRef.current = null;
        const seek = () => {
          try {
            video.currentTime = pos;
            void video.play().catch(() => {});
          } catch {
            /* ignore */
          }
        };
        if (video.readyState >= 1) seek();
        else video.addEventListener("loadedmetadata", seek, { once: true });
      };

      // First attempt at manifest parse (usually empty — harmless), then
      // re-apply whenever the track lists actually populate.
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        applySettings();
        restoreSwitchPos();
        // Always schedule Auto cascade — Vix with zero CC never fires
        // SUBTITLE_TRACKS_UPDATED (same gap Goated had).
        window.setTimeout(() => void maybeLoadFallbackSubtitles(), 1200);
      });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        if (!userTouched) applySettings();
        else syncAudioMenu();
      });

      // Fallback subtitles — Tier 1: goated VDRK open VTT built directly from
      // tmdbId (no API call, no PoW, CORS-open). Tier 3: OpenSubtitles.
      // Respects the user's subSource preference:
      //   auto   = stream CC when present, else VDRK → OpenSubtitles
      //   stream = stream's own English CC only (never inject)
      //   vdrk   = force VDRK, even if stream has CC
      //   opensub= force OpenSubtitles
      //   off    = never
      let osLoaded = false;
      let osLoading = false;
      const maybeLoadFallbackSubtitles = async () => {
        if (osLoaded || osLoading || !hls) return;
        const src = subSourceRef.current;
        if (src === "off" || src === "stream") return; // handled by applySettings
        const engTrack = hls.subtitleTracks.find((t) => matchLang(t.lang, "en"));
        const engSelected =
          !!engTrack && hls.subtitleTrack === engTrack.id;
        // In auto mode, prefer stream English CC only when it is selected.
        if (src === "auto" && engSelected) {
          osLoaded = true;
          return;
        }
        // Listed but not selected yet — select it for cue data (overlay draws).
        if (src === "auto" && engTrack && loadVixSettings().subs !== "off") {
          applying = true;
          hls.subtitleDisplay = false;
          hls.subtitleTrack = engTrack.id;
          applying = false;
          demoteShowingTracks(video);
          osLoaded = true;
          return;
        }
        // Forced external mode on a CC-bearing stream: disable the stream's own
        // CC so the injected VDRK/OS track is the ONLY one (no double subs).
        if ((src === "vdrk" || src === "opensub") && engTrack) {
          applying = true;
          hls.subtitleDisplay = false;
          hls.subtitleTrack = -1;
          applying = false;
        }
        osLoading = true;

        const delay = loadVixSettings().subDelaySeconds;
        // Tier 1 — VDRK direct, or Tier 3 — OpenSubtitles.
        // Auto on both Vix and Goated: stream CC (handled above) → VDRK → OS.
        const wantVdrk = src === "vdrk" || src === "auto";
        const wantOs = src === "opensub" || src === "auto";
        try {
          if (wantVdrk || wantOs) {
            const source = wantVdrk ? "vdrk" : "opensub";
            const ext = await fetchExternalVtt({
              source,
              type,
              tmdbId,
              season,
              episode,
              imdbId: imdbIdRef.current,
            });
            if (ext) {
              const show = loadVixSettings().subs !== "off";
              externalVttRef.current = { vtt: ext.vtt, label: ext.label };
              setHasExternalSubs(true);
              const tr = injectVttTrack(video, ext.vtt, ext.label, show, delay);
              if (tr) injectedTracksRef.current.push(tr);
              osLoaded = true;
              return;
            }
            // Forced external source failed (dead API key / empty result):
            // don't strand the picker on it — revert to Auto so stream CC (if
            // present) keeps working and the user sees WHY.
            if (src === "vdrk" || src === "opensub") {
              revertExternalSub(src);
              return;
            }
            // VDRK failed/empty → fall through to OpenSubtitles in auto mode.
            if (wantVdrk && src === "auto") {
              const os = await fetchExternalVtt({
                source: "opensub",
                type,
                tmdbId,
                season,
                episode,
                imdbId: imdbIdRef.current,
              });
              if (os) {
                const show = loadVixSettings().subs !== "off";
                externalVttRef.current = { vtt: os.vtt, label: os.label };
                setHasExternalSubs(true);
                const tr = injectVttTrack(video, os.vtt, os.label, show, delay);
                if (tr) injectedTracksRef.current.push(tr);
                osLoaded = true;
                return;
              }
            }
          }
        } finally {
          osLoading = false;
          // Only latch "done" on success; leave retryable on total miss.
        }
      };

      // Expose a re-run hook so the picker can force a source without remount.
      reloadSubsRef.current = () => {
        osLoaded = false;
        osLoading = false;
        externalVttRef.current = null;
        setHasExternalSubs(false);
        const src = subSourceRef.current;
        // Hide any previously injected external tracks.
        for (const t of injectedTracksRef.current) t.mode = "disabled";
        injectedTracksRef.current = [];
        if (src === "vdrk" || src === "opensub") {
          // Forced external source: kill the stream's own CC track so only the
          // injected VDRK/OS track shows (no double subtitles).
          if (hls) {
            applying = true;
            hls.subtitleDisplay = false;
            hls.subtitleTrack = -1;
            applying = false;
          }
        }
        // Re-apply persisted subs (handles off / stream-C C cases).
        applySettings();
        void maybeLoadFallbackSubtitles();
      };

      reapplyExternalSubsRef.current = () => {
        const cached = externalVttRef.current;
        if (!cached) return;
        for (const t of injectedTracksRef.current) t.mode = "disabled";
        injectedTracksRef.current = [];
        const delay = loadVixSettings().subDelaySeconds;
        const show = loadVixSettings().subs !== "off";
        // Disable stream CC while showing timed external track.
        if (hls) {
          applying = true;
          hls.subtitleDisplay = false;
          hls.subtitleTrack = -1;
          applying = false;
        }
        const tr = injectVttTrack(
          video,
          cached.vtt,
          cached.label,
          show,
          delay
        );
        if (tr) injectedTracksRef.current.push(tr);
      };

      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
        if (!userTouched) applySettings();
        void maybeLoadFallbackSubtitles();
      });

      // Persist user changes (and ignore switches caused by our own apply
      // or hls.js internals during initial load).
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_evt, data) => {
        if (applying) return;
        if (!hls || hls.audioTracks.length === 0) return;
        userTouched = true;
        const t = hls.audioTracks.find((x) => x.id === data.id);
        saveVixSettings({ audio: t?.lang || "en" });
        setAudioTrackId(data.id);
      });
      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_evt, data) => {
        // hls.js may flip the track to "showing"; demote so overlay owns paint.
        demoteShowingTracks(video);
        // Ignore bootstrap / internal clears — they were poisoning subs:"off"
        // while the picker still showed Auto.
        if (applying || !everApplied || !bootstrapDone) return;
        if (data.id === -1) {
          if (subSourceRef.current !== "off") return;
        }
        userTouched = true;
        const t = hls?.subtitleTracks.find((x) => x.id === data.id);
        if (subSourceRef.current === "auto" && !t) return;
        saveVixSettings({ subs: t ? t.lang : "off" });
      });
      const onTextTrackChange = () => demoteShowingTracks(video);
      video.textTracks.addEventListener("change", onTextTrackChange);
      cleanup.push(() =>
        video.textTracks.removeEventListener("change", onTextTrackChange)
      );
      hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, data) => {
        // Don't persist ABR hops while Auto is selected — that used to turn
        // Auto into a sticky fixed height after the first switch.
        if (applying) return;
        if (loadVixSettings().quality === "auto") return;
        const lv = hls?.levels[data.level];
        if (lv?.height) setQualitySelection(lv.height);
      });
      hls.on(Hls.Events.MANIFEST_LOADED, () => {
        syncQualityMenu();
      });

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls?.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls?.recoverMediaError();
        } else {
          if (Number.isFinite(video.currentTime) && video.currentTime > 0) {
            savePosition(video.currentTime, video.duration, true);
          }
          setStreamFailed(true);
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari / native HLS: persist + restore via the native track lists.
      video.src = playlistUrl;

      const s = loadVixSettings();
      let avPrimed = false;
      const applyNative = () => {
        const at = (video as unknown as { audioTracks?: NativeAudioTrackList })
          .audioTracks;
        if (at && at.length) {
          let any = false;
          for (let i = 0; i < at.length; i++) {
            const want = matchLang(at[i].language, s.audio);
            at[i].enabled = want;
            if (want) any = true;
          }
          if (!any) at[0].enabled = true;
        }
        const tt = video.textTracks as unknown as TextTrackList | undefined;
        if (tt && tt.length) {
          for (let i = 0; i < tt.length; i++) {
            const t = tt[i];
            if (t.kind === "subtitles" || t.kind === "captions") {
              t.mode =
                s.subs !== "off" && matchLang(t.language, s.subs)
                  ? "hidden"
                  : "disabled";
            }
          }
        }
        video.playbackRate = s.speed;
        if (!avPrimed) {
          video.volume = s.volume;
          video.muted = false;
          avPrimed = true;
        }
      };
      video.addEventListener("loadedmetadata", applyNative, { once: true });
      cleanup.push(() =>
        video.removeEventListener("loadedmetadata", applyNative)
      );

      const at = (video as unknown as { audioTracks?: NativeAudioTrackList })
        .audioTracks;
      const tt = video.textTracks as unknown as TextTrackList | undefined;
      const onNativeChange = () => {
        let audio = "en";
        let subs: string | "off" = "off";
        if (at) {
          for (let i = 0; i < at.length; i++) {
            if (at[i].enabled) audio = at[i].language;
          }
        }
        // Overlay uses mode "hidden" (not "showing") — treat both as active
        // so we don't poison persisted settings back to subs:"off".
        demoteShowingTracks(video);
        if (tt) {
          for (let i = 0; i < tt.length; i++) {
            const t = tt[i];
            if (
              (t.kind === "subtitles" || t.kind === "captions") &&
              t.mode !== "disabled"
            ) {
              subs = t.language || "en";
            }
          }
        }
        saveVixSettings({ audio, subs });
      };
      at?.addEventListener?.("change", onNativeChange);
      tt?.addEventListener?.("change", onNativeChange);
      cleanup.push(() => {
        at?.removeEventListener?.("change", onNativeChange);
        tt?.removeEventListener?.("change", onNativeChange);
      });

      // Safari native path: Auto cascade + forced VDRK/OpenSubtitles via
      // injected text tracks. Native HLS has no hls.subtitleTrack.
      const loadSafariExternal = async () => {
        const src = subSourceRef.current;
        if (src === "off") {
          applyNative();
          return;
        }
        if (src === "stream") {
          applyNative();
          return;
        }

        const delay = loadVixSettings().subDelaySeconds;
        const ttl = video.textTracks as unknown as TextTrackList | undefined;
        const hasEngTrack = (() => {
          if (!ttl) return false;
          for (let i = 0; i < ttl.length; i++) {
            const t = ttl[i];
            if (
              (t.kind === "subtitles" || t.kind === "captions") &&
              t.mode !== "disabled" &&
              matchLang(t.language, "en")
            ) {
              return true;
            }
          }
          return false;
        })();

        if (src === "auto") {
          applyNative();
          if (hasEngTrack) return;
          // Cascade VDRK → OS when stream has no English CC showing.
          for (const source of ["vdrk", "opensub"] as const) {
            const ext = await fetchExternalVtt({
              source,
              type,
              tmdbId,
              season,
              episode,
              imdbId: imdbIdRef.current,
            });
            if (ext) {
              if (ttl) {
                for (let i = 0; i < ttl.length; i++) {
                  const t = ttl[i];
                  if (t.kind === "subtitles" || t.kind === "captions") {
                    t.mode = "hidden";
                  }
                }
              }
              externalVttRef.current = { vtt: ext.vtt, label: ext.label };
              setHasExternalSubs(true);
              const tr = injectVttTrack(
                video,
                ext.vtt,
                ext.label,
                loadVixSettings().subs !== "off",
                delay
              );
              if (tr) injectedTracksRef.current.push(tr);
              return;
            }
          }
          return;
        }

        // Forced external — hide stream CC first.
        if (ttl) {
          for (let i = 0; i < ttl.length; i++) {
            const t = ttl[i];
            if (t.kind === "subtitles" || t.kind === "captions") {
              t.mode = "hidden";
            }
          }
        }
        const ext = await fetchExternalVtt({
          source: src,
          type,
          tmdbId,
          season,
          episode,
          imdbId: imdbIdRef.current,
        });
        if (ext) {
          externalVttRef.current = { vtt: ext.vtt, label: ext.label };
          setHasExternalSubs(true);
          const tr = injectVttTrack(video, ext.vtt, ext.label, true, delay);
          if (tr) injectedTracksRef.current.push(tr);
        } else if (src === "vdrk" || src === "opensub") {
          revertExternalSub(src);
        }
      };
      reloadSubsRef.current = () => {
        for (const t of injectedTracksRef.current) t.mode = "disabled";
        injectedTracksRef.current = [];
        externalVttRef.current = null;
        setHasExternalSubs(false);
        void loadSafariExternal();
      };
      reapplyExternalSubsRef.current = () => {
        const cached = externalVttRef.current;
        if (!cached) return;
        for (const t of injectedTracksRef.current) t.mode = "disabled";
        injectedTracksRef.current = [];
        const ttl = video.textTracks as unknown as TextTrackList | undefined;
        if (ttl) {
          for (let i = 0; i < ttl.length; i++) {
            const t = ttl[i];
            if (t.kind === "subtitles" || t.kind === "captions") {
              t.mode = "hidden";
            }
          }
        }
        const delay = loadVixSettings().subDelaySeconds;
        const tr = injectVttTrack(
          video,
          cached.vtt,
          cached.label,
          loadVixSettings().subs !== "off",
          delay
        );
        if (tr) injectedTracksRef.current.push(tr);
      };
      // Auto + forced external both need a settle delay for textTracks.
      const src0 = subSourceRef.current;
      if (src0 !== "off") {
        safariTimerRef.current = window.setTimeout(
          () => void loadSafariExternal(),
          1200
        );
      }
      // Restore position after a source switch on Safari path too.
      const pos = switchRestorePosRef.current;
      if (pos != null && Number.isFinite(pos) && pos > RESUME_MIN_SECONDS) {
        switchRestorePosRef.current = null;
        const seek = () => {
          try {
            video.currentTime = pos;
            void video.play().catch(() => {});
          } catch {
            /* ignore */
          }
        };
        if (video.readyState >= 1) seek();
        else video.addEventListener("loadedmetadata", seek, { once: true });
      }
    } else {
      setStreamFailed(true);
    }

    // Speed + volume persist on both paths.
    const onRate = () => saveVixSettings({ speed: video.playbackRate });
    const onVol = () => {
      // Persist volume only — muted is session-only (never sync / restore).
      saveVixSettings({ volume: video.volume });
    };
    video.addEventListener("ratechange", onRate);
    video.addEventListener("volumechange", onVol);
    cleanup.push(() => {
      video.removeEventListener("ratechange", onRate);
      video.removeEventListener("volumechange", onVol);
    });

    return () => {
      hls?.destroy();
      if (bootstrapTimer != null) window.clearTimeout(bootstrapTimer);
      setHlsAudioTrackRef.current = null;
      setHlsQualityRef.current = null;
      setAudioTracks([]);
      setQualityLevels([]);
      // Disable + drop injected external tracks so an episode change (or an
      // in-place vix↔goated source switch that reuses the same <video>) never
      // leaves a stale "showing" track or leaks duplicates.
      for (const t of injectedTracksRef.current) t.mode = "disabled";
      injectedTracksRef.current = [];
      externalVttRef.current = null;
      setHasExternalSubs(false);
      reloadSubsRef.current = null;
      reapplyExternalSubsRef.current = null;
      if (safariTimerRef.current != null) {
        window.clearTimeout(safariTimerRef.current);
        safariTimerRef.current = null;
      }
      for (const fn of cleanup) fn();
    };
  }, [mode, playlistUrl, savePosition, season, episode, activeSource, tmdbId, type, revertExternalSub]);

  const flushPosition = useCallback(() => {
    if (
      holdForResumeRef.current ||
      endedRef.current ||
      bookmarkClearedRef.current
    ) {
      return Promise.resolve();
    }

    if (mode === "native") {
      const v = videoRef.current;
      if (v && Number.isFinite(v.currentTime) && v.currentTime > 0) {
        savePosition(v.currentTime, v.duration, true);
      }
      return waitForPlaybackRequests();
    }

    if (mode === "iframe" && remotePositionRef.current > 0) {
      // Same gate as the message handler: closing during a startAt restart
      // must not overwrite the saved position with a tiny pre-seek report.
      if (
        resumePosRef.current > 0 &&
        remotePositionRef.current < resumePosRef.current - 1
      ) {
        return Promise.resolve();
      }
      savePosition(
        remotePositionRef.current,
        remoteDurationRef.current,
        true
      );
      return waitForPlaybackRequests();
    }
    return Promise.resolve();
  }, [mode, savePosition]);

  // ---------- native video -> event bridge + transport UI ----------
  useEffect(() => {
    if (mode !== "native" || !videoRef.current) return;
    const video = videoRef.current;

    const syncTransport = () => {
      setTransport({
        currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        paused: video.paused,
        muted: video.muted,
        volume: Number.isFinite(video.volume) ? video.volume : 1,
      });
    };

    const onPlay = () => {
      emit("play");
      syncTransport();
      bumpChrome();
    };
    const onPause = () => {
      emit("pause");
      savePosition(video.currentTime, video.duration, true);
      syncTransport();
      setChromeVisible(true);
      if (chromeHideTimerRef.current) clearTimeout(chromeHideTimerRef.current);
    };
    const onSeeked = () => {
      emit("seeked");
      // A manual scrub during the resume hold means the user wants to watch
      // from where they dragged — release the hold and drop the overlay so
      // their seek wins (was: the hold re-paused and froze the timer).
      if (holdForResumeRef.current) {
        holdForResumeRef.current = false;
        saveEnabledRef.current = true;
        setResumePosition(null);
        setResumeKey(null);
      }
      savePosition(video.currentTime, video.duration, true);
      syncTransport();
    };
    const onEnded = () => {
      if (!nearEndFiredRef.current) {
        nearEndFiredRef.current = true;
        onNearEndRef.current?.();
      }
      emit("ended");
      clearPosition();
      syncTransport();
    };
    const onTime = () => {
      // Transport scrubber needs frequent ticks; progress save stays throttled.
      syncTransport();
      const now = Date.now();
      if (now - lastTimeRef.current < 1000) return;
      lastTimeRef.current = now;
      emit("timeupdate");
      savePosition(video.currentTime, video.duration);
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      const t = video.currentTime;

      if (!nearEndFiredRef.current && isNearEndPosition(t, dur, NEXT_FAB_RATIO)) {
        nearEndFiredRef.current = true;
        onNearEndRef.current?.();
      }
      if (!endedRef.current && isFinishedPosition(t, dur)) {
        emit("ended");
        clearPosition();
      }
    };
    const onVol = () => syncTransport();
    const onMeta = () => syncTransport();

    syncTransport();
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("ended", onEnded);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("volumechange", onVol);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("durationchange", onMeta);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("volumechange", onVol);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("durationchange", onMeta);
    };
  }, [mode, emit, savePosition, clearPosition, bumpChrome]);

  useEffect(() => {
    const onFs = () => {
      const shell = shellRef.current;
      setIsFullscreen(
        !!document.fullscreenElement &&
          (document.fullscreenElement === shell ||
            shell?.contains(document.fullscreenElement) === true)
      );
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
    bumpChrome();
  }, [bumpChrome]);

  const seekBySeconds = useCallback(
    (delta: number) => {
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.currentTime)) return;
      const dur =
        Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
      const target = Math.max(0, v.currentTime + delta);
      v.currentTime = dur == null ? target : Math.min(target, dur);
      bumpChrome();
    },
    [bumpChrome]
  );

  const seekRatio = useCallback(
    (ratio: number) => {
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
      v.currentTime = Math.max(0, Math.min(v.duration, ratio * v.duration));
      bumpChrome();
    },
    [bumpChrome]
  );

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    // Session-only mute — never persisted (see vix-settings).
    v.muted = !v.muted;
    bumpChrome();
  }, [bumpChrome]);

  const setVolume = useCallback(
    (vol: number) => {
      const v = videoRef.current;
      if (!v) return;
      const next = Math.max(0, Math.min(1, vol));
      v.volume = next;
      v.muted = next === 0;
      saveVixSettings({ volume: next });
      bumpChrome();
    },
    [bumpChrome]
  );

  const toggleFullscreen = useCallback(() => {
    const root = shellRef.current;
    if (!root) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.requestFullscreen?.();
    bumpChrome();
  }, [bumpChrome]);

  // ---------- iframe fallback: postMessage bridge ----------
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const isPlayerEvent =
        typeof e.data === "object" &&
        e.data !== null &&
        (e.data as { type?: unknown }).type === "PLAYER_EVENT";
      // Nested player frames post from inner windows, so trust any VixSrc
      // player origin instead of requiring the exact embed frame/source.
      if (!isVixPlayerOrigin(e.origin)) {
        if (isPlayerEvent && !loggedRejectedOrigin) {
          loggedRejectedOrigin = true;
          console.warn(
            "[player] PLAYER_EVENT from origin",
            e.origin,
            "ignored (expected vixsrc.to)"
          );
        }
        return;
      }
      const d = parseVixPlayerEventData(e.data);
      if (!d) return;
      emit(d.event);

      if (typeof d.currentTime === "number") {
        remotePositionRef.current = d.currentTime;
      }
      if (typeof d.duration === "number" && d.duration > 0) {
        remoteDurationRef.current = d.duration;
      }

      if (d.event === "ended") {
        if (!nearEndFiredRef.current) {
          nearEndFiredRef.current = true;
          onNearEndRef.current?.();
        }
        clearPosition();
        return;
      }

      if (
        !nearEndFiredRef.current &&
        isNearEndPosition(
          remotePositionRef.current,
          remoteDurationRef.current,
          NEXT_FAB_RATIO
        )
      ) {
        nearEndFiredRef.current = true;
        onNearEndRef.current?.();
      }

      // Auto-complete once the embed crosses ~92% (same rationale as the
      // native path — a vixsrc iframe can stall/drift before firing its own
      // "ended", leaving an otherwise-finished watch unmarked). emit("ended")
      // is idempotent, so the dedup guard prevents duplicate marks.
      if (
        !endedRef.current &&
        isFinishedPosition(
          remotePositionRef.current,
          remoteDurationRef.current
        )
      ) {
        emit("ended");
        clearPosition();
        // Skip the resume-bookmark logic below; the item is now complete.
        return;
      }

      if (remotePositionRef.current <= 0) return;

      // Resume gate: a startAt restart can report tiny positions before the
      // embed seeks to the bookmark — never let those overwrite a real one.
      if (resumePosRef.current > 0) {
        if (remotePositionRef.current >= resumePosRef.current - 1) {
          resumePosRef.current = 0;
        } else if (d.event === "timeupdate" || d.event === "pause") {
          return;
        }
      }

      if (d.event === "pause" || d.event === "seeked") {
        savePosition(
          remotePositionRef.current,
          remoteDurationRef.current,
          true
        );
      } else if (d.event === "timeupdate") {
        // Persist only positions worth resuming — a sub-5s report (e.g. after
        // a failed resume lookup) must not wipe the existing bookmark.
        if (
          !isResumablePosition(
            remotePositionRef.current,
            remoteDurationRef.current
          )
        ) {
          return;
        }
        savePosition(remotePositionRef.current, remoteDurationRef.current);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [clearPosition, emit, savePosition]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Subtitle/audio menus own Escape while open (capture listener closes them).
      if (subMenuOpen || audioMenuOpen || qualityMenuOpen) return;
      // First Escape exits fullscreen; second closes the player.
      if (document.fullscreenElement) {
        e.preventDefault();
        void document.exitFullscreen();
        return;
      }
      void flushPosition().then(() => {
        onCloseRef.current();
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flushPosition, subMenuOpen, audioMenuOpen, qualityMenuOpen]);

  // Desktop keyboard shortcuts (native only). Custom chrome owns transport —
  // no native <video controls> to double-toggle against.
  useEffect(() => {
    if (mode !== "native" || locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (subMenuOpen || audioMenuOpen || qualityMenuOpen) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const v = videoRef.current;
      if (!v) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === " " || key === "k") {
        e.preventDefault();
        e.stopPropagation();
        if (v.paused) void v.play();
        else v.pause();
        bumpChrome();
      } else if (key === "ArrowRight" || key === "l") {
        e.preventDefault();
        e.stopPropagation();
        v.currentTime = Math.min(v.duration || 1e9, v.currentTime + 10);
        bumpChrome();
      } else if (key === "ArrowLeft" || key === "j") {
        e.preventDefault();
        e.stopPropagation();
        v.currentTime = Math.max(0, v.currentTime - 10);
        bumpChrome();
      } else if (key === "m") {
        e.preventDefault();
        e.stopPropagation();
        v.muted = !v.muted;
        bumpChrome();
      } else if (key === "f") {
        e.preventDefault();
        e.stopPropagation();
        const root = shellRef.current;
        if (!root) return;
        if (document.fullscreenElement) void document.exitFullscreen();
        else void root.requestFullscreen?.();
        bumpChrome();
      } else if (key === "p") {
        e.preventDefault();
        e.stopPropagation();
        if (document.pictureInPictureElement) {
          void document.exitPictureInPicture();
        } else if (document.pictureInPictureEnabled) {
          void v.requestPictureInPicture?.();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mode, locked, subMenuOpen, audioMenuOpen, qualityMenuOpen, bumpChrome]);

  const adjustSubDelay = useCallback((delta: number) => {
    const next = Math.max(
      -10,
      Math.min(10, Math.round((subDelay + delta) * 2) / 2)
    );
    setSubDelay(next);
    saveVixSettings({ subDelaySeconds: next });
    // Prefer re-timing the cached VTT — do NOT re-fetch (that was the sync bug).
    if (externalVttRef.current && reapplyExternalSubsRef.current) {
      reapplyExternalSubsRef.current();
    }
  }, [subDelay]);

  const patchSubStyle = useCallback(
    (patch: Partial<Pick<VixSettings, "subFontSize" | "subColor" | "subBgOpacity">>) => {
      if (patch.subFontSize) setSubFontSize(patch.subFontSize);
      if (patch.subColor) setSubColor(patch.subColor);
      if (typeof patch.subBgOpacity === "number") setSubBgOpacity(patch.subBgOpacity);
      saveVixSettings(patch);
    },
    []
  );

  // Mobile / tab kill: flush position on hide (keepalive survives the unload).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") flushPosition();
    };
    window.addEventListener("pagehide", flushPosition);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flushPosition);
      document.removeEventListener("visibilitychange", onVis);
      flushPosition();
    };
  }, [flushPosition]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const isLoading = mode === "loading";
  const hasError = mode === "error";
  const playbackKey = playbackParams();
  const showResume =
    mode === "native" &&
    !autoResume &&
    resumePosition != null &&
    resumeKey === playbackKey;
  const iframeSrc = addStartAt(src, resumePosition ?? initialResumePosition);

  return (
    <div
      ref={shellRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} player`}
      className="fixed inset-0 z-[100] flex flex-col bg-black"
    >
      {mode === "native" && (
        <video
          ref={videoRef}
          // Custom chrome only — native controls caused dual-layer lock UI.
          controls={false}
          autoPlay
          playsInline
          disablePictureInPicture={false}
          onTouchEnd={handleTap}
          onClick={handleVideoClick}
          className="h-full w-full touch-manipulation bg-black"
        />
      )}

      {mode === "native" && (
        <SubtitleOverlay
          videoRef={videoRef}
          enabled={subSource !== "off"}
          fontScale={SUB_FONT_SCALE[subFontSize]}
          color={SUB_COLORS[subColor]}
          bgOpacity={subBgOpacity}
        />
      )}

      {mode === "iframe" && (
        <iframe
          key={iframeSrc}
          ref={iframeRef}
          src={iframeSrc}
          title={title}
          // vixsrc.to WAF blocks referers from *.vercel.app — strip it so the
          // fallback embed can load on Vercel-hosted prod.
          referrerPolicy="no-referrer"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write"
          allowFullScreen
          onLoad={() => setIframeError(false)}
          onError={() => setIframeError(true)}
          className="h-full w-full border-0 bg-black"
        />
      )}

      {showResume && (
        <ResumeOverlay
          positionSeconds={resumePosition ?? 0}
          onResume={handleResume}
          onRestart={handleRestart}
        />
      )}

      {!locked && chromeVisible && mode === "native" && (
        <PlayerTransport
          currentTime={transport.currentTime}
          duration={transport.duration}
          paused={transport.paused}
          muted={transport.muted}
          volume={transport.volume}
          isFullscreen={isFullscreen}
          onTogglePlay={togglePlay}
          onSeekBy={seekBySeconds}
          onSeekRatio={seekRatio}
          onToggleMute={toggleMute}
          onVolume={setVolume}
          onToggleFullscreen={toggleFullscreen}
        />
      )}

      {!locked && chromeVisible && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/90 via-black/45 to-transparent pt-safe">
          <div className="flex items-start justify-between gap-3 px-4 pb-8 pt-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-white">{title}</p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
                {activeSource === "goated" ? "Goated · Orbit" : "VixSrc"}
              </p>
            </div>
            <div className="pointer-events-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
              {mode === "native" && (
                <button
                  type="button"
                  onClick={() => {
                    const v = videoRef.current;
                    const speeds = [0.75, 1, 1.25, 1.5, 2];
                    const next =
                      speeds[
                        (speeds.indexOf(playbackSpeed) + 1) % speeds.length
                      ] ?? 1;
                    setPlaybackSpeed(next);
                    saveVixSettings({ speed: next });
                    if (v) v.playbackRate = next;
                  }}
                  aria-label="Playback speed"
                  className="flex h-9 items-center rounded-full bg-black/60 px-3 text-xs font-bold text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80"
                >
                  {playbackSpeed}×
                </button>
              )}
              {mode === "native" && audioTracks.length > 1 && (
                <div ref={audioMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setChromeVisible(true);
                      if (chromeHideTimerRef.current) {
                        clearTimeout(chromeHideTimerRef.current);
                      }
                      setAudioMenuOpen((v) => !v);
                      setSubMenuOpen(false);
                      setQualityMenuOpen(false);
                    }}
                    aria-label="Audio track"
                    aria-expanded={audioMenuOpen}
                    className="flex h-9 items-center gap-1.5 rounded-full bg-black/60 px-3 text-xs font-bold text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80"
                  >
                    <Volume2 className="h-4 w-4" />
                    <span className="hidden sm:inline">Audio</span>
                  </button>
                  {audioMenuOpen && (
                    <div
                      role="menu"
                      aria-label="Audio tracks"
                      className="absolute right-0 top-full z-30 mt-2 max-h-[50vh] w-56 overflow-y-auto rounded-xl border border-white/10 bg-card shadow-xl"
                    >
                      {audioTracks.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setHlsAudioTrackRef.current?.(t.id);
                            setAudioMenuOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm font-medium text-white transition hover:bg-secondary",
                            audioTrackId === t.id && "text-primary"
                          )}
                        >
                          <span className="truncate">
                            {t.name || t.lang || `Track ${t.id}`}
                          </span>
                          {audioTrackId === t.id && (
                            <Check className="h-4 w-4 flex-shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {mode === "native" && qualityLevels.length > 0 && (
                <div ref={qualityMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setChromeVisible(true);
                      if (chromeHideTimerRef.current) {
                        clearTimeout(chromeHideTimerRef.current);
                      }
                      setQualityMenuOpen((v) => !v);
                      setSubMenuOpen(false);
                      setAudioMenuOpen(false);
                    }}
                    aria-label="Quality"
                    aria-expanded={qualityMenuOpen}
                    className="flex h-9 items-center gap-1.5 rounded-full bg-black/60 px-3 text-xs font-bold text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80"
                  >
                    <Gauge className="h-4 w-4" />
                    <span className="hidden sm:inline">
                      {qualitySelection === "auto"
                        ? "Auto"
                        : `${qualitySelection}p`}
                    </span>
                  </button>
                  {qualityMenuOpen && (
                    <div
                      role="menu"
                      aria-label="Video quality"
                      className="absolute right-0 top-full z-30 mt-2 max-h-[50vh] w-44 overflow-y-auto rounded-xl border border-white/10 bg-card shadow-xl"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setHlsQualityRef.current?.("auto");
                          setQualityMenuOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm font-medium text-white transition hover:bg-secondary",
                          qualitySelection === "auto" && "text-primary"
                        )}
                      >
                        Auto
                        {qualitySelection === "auto" && (
                          <Check className="h-4 w-4 flex-shrink-0" />
                        )}
                      </button>
                      {qualityLevels.map((lv) => (
                        <button
                          key={lv.height}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setHlsQualityRef.current?.(lv.height);
                            setQualityMenuOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm font-medium text-white transition hover:bg-secondary",
                            qualitySelection === lv.height && "text-primary"
                          )}
                        >
                          {lv.height}p
                          {qualitySelection === lv.height && (
                            <Check className="h-4 w-4 flex-shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {mode === "native" && (
                <div ref={subMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setChromeVisible(true);
                      if (chromeHideTimerRef.current) {
                        clearTimeout(chromeHideTimerRef.current);
                      }
                      setSubMenuOpen((v) => !v);
                      setAudioMenuOpen(false);
                      setQualityMenuOpen(false);
                    }}
                    aria-label="Subtitles"
                    aria-expanded={subMenuOpen}
                    aria-haspopup="menu"
                    className="flex h-9 items-center gap-1.5 rounded-full bg-black/60 px-3 text-xs font-bold text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80"
                  >
                    <Captions className="h-4 w-4" />
                    <span className="hidden sm:inline">CC</span>
                  </button>
                  {subMenuOpen && (
                    <div
                      role="menu"
                      aria-label="Subtitles"
                      className="absolute right-0 top-full z-30 mt-2 w-56 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/10 bg-card shadow-xl"
                      onMouseDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                    >
                      {(
                        [
                          ["auto", "Auto"],
                          ["stream", "Stream"],
                          ["vdrk", "VDRK"],
                          ["opensub", "OpenSubs"],
                          ["off", "Off"],
                        ] as const
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          role="menuitem"
                          onClick={() => handleSubSource(key)}
                          className={cn(
                            "flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm font-semibold text-white hover:bg-secondary",
                            subSource === key && "bg-secondary/60 text-primary"
                          )}
                        >
                          {label}
                          {subSource === key && (
                            <Check className="h-4 w-4 flex-shrink-0" />
                          )}
                        </button>
                      ))}

                      {subSource !== "off" &&
                        (subSource === "vdrk" ||
                          subSource === "opensub" ||
                          hasExternalSubs) && (
                        <div className="flex items-center justify-between border-t border-white/10 px-3.5 py-2.5">
                          <span className="text-xs font-semibold text-white/70">
                            Sync
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                adjustSubDelay(-0.5);
                              }}
                              className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-sm font-bold text-white"
                              aria-label="Earlier"
                            >
                              −
                            </button>
                            <span className="min-w-[2.75rem] text-center text-xs font-bold tabular-nums text-primary">
                              {subDelay > 0 ? "+" : ""}
                              {subDelay.toFixed(1)}s
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                adjustSubDelay(0.5);
                              }}
                              className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-sm font-bold text-white"
                              aria-label="Later"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      )}

                      {subSource !== "off" && (
                        <div className="space-y-2.5 border-t border-white/10 px-3.5 py-3">
                          <div className="flex items-center gap-1.5">
                            {(
                              [
                                ["sm", "100%"],
                                ["md", "112%"],
                                ["lg", "125%"],
                              ] as const
                            ).map(([key, label]) => (
                              <button
                                key={key}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  patchSubStyle({ subFontSize: key });
                                }}
                                className={cn(
                                  "flex h-8 flex-1 items-center justify-center rounded-lg text-[11px] font-bold",
                                  subFontSize === key
                                    ? "bg-primary text-black"
                                    : "bg-secondary text-white"
                                )}
                                aria-label={`Size ${label}`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            {(
                              [
                                ["white", "#fff"],
                                ["yellow", "#ffe566"],
                                ["cyan", "#7dd3fc"],
                              ] as const
                            ).map(([key, hex]) => (
                              <button
                                key={key}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  patchSubStyle({ subColor: key });
                                }}
                                aria-label={key}
                                className={cn(
                                  "h-8 w-8 rounded-full ring-2",
                                  subColor === key
                                    ? "ring-primary"
                                    : "ring-white/20"
                                )}
                                style={{ backgroundColor: hex }}
                              />
                            ))}
                            <div className="ml-auto flex gap-1">
                              {(
                                [
                                  [0, "0"],
                                  [0.4, "½"],
                                  [0.85, "1"],
                                ] as const
                              ).map(([value, label]) => (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    patchSubStyle({ subBgOpacity: value });
                                  }}
                                  className={cn(
                                    "h-8 min-w-8 rounded-lg px-1.5 text-[10px] font-bold",
                                    subBgOpacity === value
                                      ? "bg-primary text-black"
                                      : "bg-secondary text-white"
                                  )}
                                  aria-label={`Background ${label}`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {subError && (
                        <p className="border-t border-white/10 px-3.5 py-2 text-[10px] font-medium text-red-400">
                          {subError}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              {streamable && (
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() =>
                    switchSource(activeSource === "vix" ? "goated" : "vix")
                  }
                  aria-label={`Switch source (currently ${activeSource})`}
                  className="flex h-9 items-center gap-1.5 rounded-full bg-black/60 px-3 text-xs font-bold text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80 disabled:opacity-50"
                >
                  <span className="hidden sm:inline">Source</span>
                  <span className="text-white/60">
                    {activeSource === "vix" ? "Vix" : "Goated"}
                  </span>
                </button>
              )}
              {mode === "native" &&
                typeof document !== "undefined" &&
                document.pictureInPictureEnabled && (
                  <button
                    type="button"
                    onClick={() => {
                      const v = videoRef.current;
                      if (!v) return;
                      if (document.pictureInPictureElement) {
                        void document.exitPictureInPicture();
                      } else {
                        void v.requestPictureInPicture?.();
                      }
                    }}
                    aria-label="Picture in picture"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80"
                  >
                    <PictureInPicture2 className="h-4 w-4" />
                  </button>
                )}
              <button
                type="button"
                onClick={() => setLocked(true)}
                aria-label="Lock player controls"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80"
              >
                <Lock className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  void flushPosition().then(() => {
                    onClose();
                  });
                }}
                aria-label="Close player"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {locked && (
        <button
          type="button"
          onClick={() => {
            setLocked(false);
            setChromeVisible(true);
          }}
          aria-label="Unlock player controls"
          className="absolute right-4 top-4 z-40 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80"
        >
          <LockOpen className="h-5 w-5" />
        </button>
      )}

      {mode === "iframe" && !locked && (
        <p className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-[10px] font-semibold text-white/70 backdrop-blur">
          Embed controls only — switch source for CC / speed / audio
        </p>
      )}

      {mode === "native" && tapCue && (
        <div
          className={`pointer-events-none absolute inset-y-0 z-40 flex items-center ${
            tapCue.side === "right" ? "justify-end pr-6" : "justify-start pl-6"
          }`}
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/70 text-lg font-bold text-white backdrop-blur">
            {tapCue.side === "right" ? "+10" : "−10"}
          </span>
        </div>
      )}

      {isLoading && (
        <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center text-white/70">
          <div className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-xs font-semibold backdrop-blur">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Loading {activeSource === "goated" ? "Goated" : "Vix"}…
          </div>
        </div>
      )}

      {hasError && (
        <div className="absolute inset-0 z-[6] flex items-center justify-center bg-black/85 p-6 text-center">
          <div>
            <p className="font-bold text-white">Player unavailable here</p>
            <p className="mt-1 text-sm text-white/55">
              Try switching to another source.
            </p>
            {streamable && (
              <button
                type="button"
                onClick={() =>
                  switchSource(activeSource === "vix" ? "goated" : "vix")
                }
                className="mt-4 inline-flex items-center rounded-full bg-primary px-4 py-2 text-sm font-bold text-black"
              >
                Try {activeSource === "vix" ? "Goated" : "Vix"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
