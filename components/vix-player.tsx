"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, LockOpen } from "lucide-react";
import {
  isVixPlayerOrigin,
  parseVixPlayerEventData,
} from "@/lib/vixsrc";
import { ResumeOverlay } from "@/components/resume-overlay";
import { SubtitleOverlay } from "@/components/subtitle-overlay";
import { PlayerTransport } from "@/components/player-transport";
import { PlayerTopChrome } from "@/components/player-top-chrome";
import {
  loadVixSettings,
  saveVixSettings,
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
} from "@/lib/player-progress";
import {
  createClearPosition,
  createSavePosition,
  waitForPlaybackRequests,
} from "@/lib/player-progress-save";
import { SUB_COLORS, SUB_FONT_SCALE, type SubSource } from "@/lib/player-subs";
import { attachNativePlayback } from "@/lib/player-engine";
import { resolveStreamPlaylist } from "@/lib/player-stream";
import { seekVideoElement } from "@/lib/player-seek";
import type {
  AudioTrackInfo,
  QualityLevelInfo,
  StreamSource,
} from "@/lib/player-native-types";

// Log a rejected iframe origin once per page load (not per message — spam).
let loggedRejectedOrigin = false;

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
  const [activeSource, setActiveSource] = useState<StreamSource>(
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
  const [audioTracks, setAudioTracks] = useState<AudioTrackInfo[]>([]);
  const [audioTrackId, setAudioTrackId] = useState<number>(-1);
  const setHlsAudioTrackRef = useRef<((id: number) => void) | null>(null);
  const [qualityLevels, setQualityLevels] = useState<QualityLevelInfo[]>([]);
  const [qualitySelection, setQualitySelection] = useState<"auto" | number>(
    () => loadVixSettings().quality
  );
  const setHlsQualityRef = useRef<((next: "auto" | number) => void) | null>(
    null
  );
  const [subSource, setSubSource] = useState<SubSource>(() => {
    const s = loadVixSettings();
    // Repair bootstrap poison: Auto/stream/external must not keep subs:"off".
    if (s.subSource !== "off" && s.subs === "off") {
      saveVixSettings({ subs: "en" });
    }
    return s.subSource;
  });
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

  const savePosition = useCallback(
    (pos: number, duration: number, force = false) => {
      // Source switch: HLS often reports 0–few seconds before the restore
      // seek lands. Never let those wipe a good mid-episode bookmark (this is
      // why Goated→Vix looked like it "lost" resume).
      const pendingSwitch = switchRestorePosRef.current;
      if (
        pendingSwitch != null &&
        Number.isFinite(pendingSwitch) &&
        pos < pendingSwitch - 2
      ) {
        return;
      }
      // Same gate while the resume overlay / lookup is holding.
      const pendingResume = resumePosRef.current;
      if (
        holdForResumeRef.current &&
        pendingResume > 0 &&
        pos < pendingResume - 2
      ) {
        return;
      }
      // Delegate to shared save rules (throttle, 92% clear, ordered queue).
      const run = createSavePosition(playbackParams, {
        saveEnabledRef,
        endedRef,
        bookmarkClearedRef,
        lastSavedPosRef,
        lastSavedAtRef,
      });
      run(pos, duration, force);
    },
    [playbackParams]
  );

  const clearPosition = useCallback(() => {
    const run = createClearPosition(playbackParams, {
      saveEnabledRef,
      endedRef,
      bookmarkClearedRef,
      lastSavedPosRef,
      lastSavedAtRef,
    });
    run();
  }, [playbackParams]);

  const seekVideo = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(t)) return;
    // Shared robust seek (HLS often needs retries before currentTime sticks).
    seekVideoElement(v, t, { play: true });
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

  // Iframe path: no seek API for the embed, so drop any resume prompt.
  // Lookup effect enables saves when it finishes; if we already have a
  // supplied position, enable immediately.
  useEffect(() => {
    if (mode !== "iframe") return;
    holdForResumeRef.current = false;
    if (initialResumePosition != null || resumePosition != null) {
      saveEnabledRef.current = true;
    }
  }, [initialResumePosition, mode, resumePosition]);

  // ---------- source switching ----------
  const switchSource = useCallback((next: StreamSource) => {
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
    if (pos != null) {
      switchRestorePosRef.current = pos;
      // Keep throttle baseline at the real position so tiny pre-seek reports
      // don't pass the min-delta check as "progress".
      lastSavedPosRef.current = pos;
      lastSavedAtRef.current = Date.now();
      // Persist to server before tearing down the video element.
      savePosition(pos, v && Number.isFinite(v.duration) ? v.duration : 0, true);
    } else {
      lastSavedPosRef.current = 0;
      lastSavedAtRef.current = 0;
    }
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
  }, [activeSource, savePosition]);

  /** Subtitle source picker: persist choice + re-run the subtitle loader. */
  const handleSubSource = useCallback(
    (next: SubSource) => {
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
    if (!streamable || !tmdbId || !type) return;
    let cancelled = false;
    const controller = new AbortController();
    void resolveStreamPlaylist({
      source: activeSource,
      type,
      tmdbId,
      season,
      episode,
      signal: controller.signal,
    }).then((result) => {
      if (cancelled) return;
      imdbIdRef.current = result.imdbId;
      if (result.playlistUrl) {
        setPlaylistUrl(result.playlistUrl);
        return;
      }
      if (result.failed) {
        console.warn(
          `[player] ${activeSource} stream resolution failed — falling back to iframe:`,
          result.errorMessage ?? "no playlist"
        );
        setStreamFailed(true);
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [streamable, type, tmdbId, season, episode, activeSource]);

  // ---------- native playback (hls.js / Safari native) ----------
  useEffect(() => {
    if (mode !== "native" || !playlistUrl || !videoRef.current) return;
    return attachNativePlayback({
      video: videoRef.current,
      playlistUrl,
      type,
      tmdbId,
      season,
      episode,
      imdbIdRef,
      switchRestorePosRef,
      subSourceRef,
      injectedTracksRef,
      externalVttRef,
      reloadSubsRef,
      reapplyExternalSubsRef,
      safariTimerRef,
      setHlsAudioTrackRef,
      setHlsQualityRef,
      setAudioTracks,
      setAudioTrackId,
      setQualityLevels,
      setQualitySelection,
      setHasExternalSubs,
      setStreamFailed,
      savePosition,
      revertExternalSub,
    });
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
          chromeRaised={!locked && chromeVisible}
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
        <PlayerTopChrome
          title={title}
          mode={mode}
          activeSource={activeSource}
          streamable={streamable}
          isLoading={isLoading}
          playbackSpeed={playbackSpeed}
          onCycleSpeed={() => {
            const v = videoRef.current;
            const speeds = [0.75, 1, 1.25, 1.5, 2];
            const next =
              speeds[(speeds.indexOf(playbackSpeed) + 1) % speeds.length] ?? 1;
            setPlaybackSpeed(next);
            saveVixSettings({ speed: next });
            if (v) v.playbackRate = next;
          }}
          audioTracks={audioTracks}
          audioTrackId={audioTrackId}
          audioMenuOpen={audioMenuOpen}
          setAudioMenuOpen={setAudioMenuOpen}
          qualityLevels={qualityLevels}
          qualitySelection={qualitySelection}
          qualityMenuOpen={qualityMenuOpen}
          setQualityMenuOpen={setQualityMenuOpen}
          subSource={subSource}
          subMenuOpen={subMenuOpen}
          setSubMenuOpen={setSubMenuOpen}
          onSubSource={handleSubSource}
          hasExternalSubs={hasExternalSubs}
          subDelay={subDelay}
          onAdjustSubDelay={adjustSubDelay}
          subFontSize={subFontSize}
          subColor={subColor}
          subBgOpacity={subBgOpacity}
          onPatchSubStyle={patchSubStyle}
          subError={subError}
          onSwitchSource={() =>
            switchSource(activeSource === "vix" ? "goated" : "vix")
          }
          onLock={() => setLocked(true)}
          onClose={() => {
            void flushPosition().then(() => {
              onClose();
            });
          }}
          onKeepChrome={() => {
            setChromeVisible(true);
            if (chromeHideTimerRef.current) {
              clearTimeout(chromeHideTimerRef.current);
            }
          }}
          subMenuRef={subMenuRef}
          audioMenuRef={audioMenuRef}
          qualityMenuRef={qualityMenuRef}
          setHlsAudioTrackRef={setHlsAudioTrackRef}
          setHlsQualityRef={setHlsQualityRef}
        />
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
