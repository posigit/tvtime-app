"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, LockOpen } from "lucide-react";
import {
  parseVixPlayerEventData,
} from "@/lib/vixsrc";
import {
  EMBED_SOURCES,
  embedUrlFor,
  isEmbedPlayerOrigin,
  sendCineSrcCommand,
  sendVidfastCommand,
  sourceLabel,
} from "@/lib/embed-sources";
import { ResumeOverlay } from "@/components/resume-overlay";
import {
  IframeSubtitleOverlay,
  SubtitleOverlay,
} from "@/components/subtitle-overlay";
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
  isPreSeekNoise,
  isResumablePosition,
  makePlaybackKey,
} from "@/lib/player-progress";
import {
  createClearPosition,
  createSavePosition,
  waitForPlaybackRequests,
} from "@/lib/player-progress-save";
import {
  SUB_COLORS,
  SUB_FONT_SCALE,
  cueTextAt,
  fetchExternalVtt,
  injectVttTrack,
  listOpenSubtitles,
  parseVttCues,
  type OpenSubListItem,
  type SubSource,
  type VttCue,
} from "@/lib/player-subs";
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

/** One-time 4s hint shown when playing inside an embed (iframe controls only). */
function EmbedHint() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;
  return (
    <p className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-[10px] font-semibold text-white/70 backdrop-blur">
      Embed controls only — switch source for CC / speed / audio
    </p>
  );
}
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
  const iframePausedRef = useRef(true);
  const iframeMutedRef = useRef(false);
  /** Parsed VDRK cues rendered over the CineSrc iframe (no <video> track). */
  const [iframeCues, setIframeCues] = useState<VttCue[]>([]);
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
  const resumePosRef = useRef(0);
  /**
   * Pending seek for source-switch OR cold resume. Engine applies after HLS
   * is ready (startPosition + MANIFEST/FRAG) — required for Vix resolver.
   */
  const pendingSeekPosRef = useRef<number | null>(null);
  const pendingSeekWaitersRef = useRef<
    Array<(ok: boolean) => void>
  >([]);

  const streamable = type === "movie" || type === "tv";
  // Source backend — prefer last user choice, then prop default.
  // Movie-only embeds (empty tvUrl) fall back to vix so the picker label
  // matches what the iframe actually loads.
  const [activeSource, setActiveSource] = useState<StreamSource>(() => {
    const preferred = loadVixSettings().preferredSource || source;
    if (
      type &&
      tmdbId &&
      EMBED_SOURCES.some((s) => s.key === preferred) &&
      !embedUrlFor(preferred, type, tmdbId, season, episode)
    ) {
      return source;
    }
    return preferred;
  });
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null);
  // Non-streamable mounts (no type/tmdbId) go straight to iframe fallback.
  const [streamFailed, setStreamFailed] = useState(() => !streamable);
  const [iframeError, setIframeError] = useState(false);
  // Do not seed from RSC props — a dismissed Continue Watching delete must
  // win over a stale show-page bookmark. Lookup always re-reads /api/playback.
  const [resumePosition, setResumePosition] = useState<number | null>(null);
  const [resumeKey, setResumeKey] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  /** Custom chrome only — native <video controls> are off (dual-layer fix). */
  const [chromeVisible, setChromeVisible] = useState(true);
  /** True once the media element can actually play (not just playlist resolved). */
  const [mediaReady, setMediaReady] = useState(false);
  /** True while a resume seek is in flight (hide transport so we don't flash 0:00). */
  const [resumeSeeking, setResumeSeeking] = useState(false);
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
  const [autoplayNext, setAutoplayNext] = useState(
    () => loadVixSettings().autoplayNext
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
  /** Top OpenSubtitles files (max 3) for the CC picker. */
  const [openSubItems, setOpenSubItems] = useState<OpenSubListItem[]>([]);
  const [openSubFileId, setOpenSubFileId] = useState<number | null>(null);
  const [openSubListLoading, setOpenSubListLoading] = useState(false);
  const openSubListKeyRef = useRef<string | null>(null);
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

  // Embed sources have no native resolver — always play as iframe.
  // (Registered embed keys count even when they have no URL for this media
  // shape — e.g. movie-only embeds on a TV show — so we fall back to the
  // vixsrc iframe instead of running the native goated cascade.)
  const isEmbedActive = EMBED_SOURCES.some((s) => s.key === activeSource);
  // mode: native -> iframe -> error
  const mode = isEmbedActive
    ? iframeError
      ? "error"
      : "iframe"
    : streamFailed
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
    iframePausedRef.current = true;
    bookmarkClearedRef.current = false;
    lastTapRef.current = null;
    setMediaReady(false);
    setIframeCues([]);
    setOpenSubFileId(null);
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
      // Pending engine seek / resume floor: drop 0–5s warmup reports only.
      // A backward scrub (43:00 → 3:00) must save — that is the new bookmark.
      if (isPreSeekNoise(pos, pendingSeekPosRef.current)) return;
      if (isPreSeekNoise(pos, resumePosRef.current)) return;
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
    if (!v || !Number.isFinite(t)) return Promise.resolve(false);
    // Shared robust seek (HLS often needs retries before currentTime sticks).
    return seekVideoElement(v, t, { play: true });
  }, []);

  /**
   * Queue a resume/switch seek for the engine (post-manifest / startPosition).
   * Do NOT currentTime-spam before Vix resolver HLS is ready — that is why
   * cold-start Vix always opened at 0 while Goated and mid-session switch worked.
   */
  const seekAndArmSaves = useCallback(
    async (pos: number) => {
      if (!(pos > RESUME_MIN_SECONDS)) {
        holdForResumeRef.current = false;
        saveEnabledRef.current = true;
        setResumeSeeking(false);
        pendingSeekPosRef.current = null;
        return;
      }
      setResumeSeeking(true);
      resumePosRef.current = pos;
      holdForResumeRef.current = true;
      saveEnabledRef.current = false;
      bookmarkClearedRef.current = false;
      lastSavedPosRef.current = pos;
      lastSavedAtRef.current = Date.now();
      pendingSeekPosRef.current = pos;

      const ok = await new Promise<boolean>((resolve) => {
        let settled = false;
        let poll = 0;
        const finish = (result: boolean) => {
          if (settled) return;
          settled = true;
          window.clearInterval(poll);
          resolve(result);
        };
        pendingSeekWaitersRef.current.push(finish);
        const started = Date.now();
        poll = window.setInterval(() => {
          const v = videoRef.current;
          if (
            v &&
            Number.isFinite(v.currentTime) &&
            Math.abs(v.currentTime - pos) <= 2.5
          ) {
            if (pendingSeekPosRef.current === pos) {
              pendingSeekPosRef.current = null;
            }
            finish(true);
            return;
          }
          if (Date.now() - started > 16_000) {
            finish(false);
          }
        }, 250);
      });

      // Drain any leftover waiters.
      pendingSeekWaitersRef.current = [];
      holdForResumeRef.current = false;
      saveEnabledRef.current = true;
      setResumeSeeking(false);
      if (ok) {
        const v = videoRef.current;
        const t = v && Number.isFinite(v.currentTime) ? v.currentTime : pos;
        savePosition(t, v?.duration ?? 0, true);
        window.setTimeout(() => {
          if (resumePosRef.current === pos) resumePosRef.current = 0;
        }, 4000);
      } else {
        // Seek never landed. Drop the pending target so a later manual
        // scrub / close flush can still save. Keep resumePos briefly as a
        // 0s-noise floor only.
        if (pendingSeekPosRef.current === pos) pendingSeekPosRef.current = null;
        console.warn(
          "[player] resume seek did not land near",
          pos,
          "— protecting bookmark from 0s saves"
        );
        window.setTimeout(() => {
          if (resumePosRef.current === pos) resumePosRef.current = 0;
        }, 30_000);
      }
    },
    [savePosition]
  );

  const onPendingSeekSettled = useCallback(
    (result: { pos: number; ok: boolean }) => {
      const waiters = pendingSeekWaitersRef.current;
      pendingSeekWaitersRef.current = [];
      for (const w of waiters) w(result.ok);
      if (result.ok) {
        const v = videoRef.current;
        if (v && Number.isFinite(v.currentTime) && v.currentTime > 0) {
          // Ensure play after engine seek (hold may have paused).
          void v.play().catch(() => {});
        }
      }
    },
    []
  );

  /** Clamp a target time to the driven embed's known duration. */
  const clampEmbedTime = (target: number): number => {
    const dur = remoteDurationRef.current;
    return dur > 0 ? Math.max(0, Math.min(target, dur)) : Math.max(0, target);
  };

  /** Seek the active driven embed (CineSrc and VidFast command channels). */
  const sendEmbedSeek = useCallback(
    (target: number) => {
      if (activeSource === "cinesrc") {
        sendCineSrcCommand(iframeRef.current, "seek", [target]);
      } else if (activeSource === "vidfast") {
        sendVidfastCommand(iframeRef.current, "seek", { time: target });
      }
    },
    [activeSource]
  );

  /** True for iframe embeds we can drive (transport + lock parity). */
  const isDrivenEmbed =
    mode === "iframe" &&
    (activeSource === "cinesrc" || activeSource === "vidfast");
  const vidfastEmbed = mode === "iframe" && activeSource === "vidfast";
  const mappleEmbed = mode === "iframe" && activeSource === "mapple";
  /** Embeds with a usable playback clock: driven (transport) + Mapple (subs). */
  const clockEmbed = isDrivenEmbed || mappleEmbed;

  /** Native / driven-embed ±10s seek, with a transient on-screen cue. */
  const seekBy = useCallback(
    (side: "left" | "right") => {
      const delta = side === "right" ? 10 : -10;
      if (isDrivenEmbed) {
        sendEmbedSeek(
          clampEmbedTime(remotePositionRef.current + delta)
        );
        setTapCue({ side });
        if (tapCueTimerRef.current) clearTimeout(tapCueTimerRef.current);
        tapCueTimerRef.current = setTimeout(() => setTapCue(null), 650);
        return;
      }
      const v = videoRef.current;
      if (!v || mode !== "native" || !Number.isFinite(v.currentTime)) return;
      const target = Math.max(0, v.currentTime + delta);
      const dur =
        Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
      v.currentTime = dur == null ? target : Math.min(target, dur);
      setTapCue({ side });
      if (tapCueTimerRef.current) clearTimeout(tapCueTimerRef.current);
      tapCueTimerRef.current = setTimeout(() => setTapCue(null), 650);
    },
    [isDrivenEmbed, sendEmbedSeek]
  );

  const bumpChrome = useCallback(() => {
    if (locked) return;
    setChromeVisible(true);
    if (chromeHideTimerRef.current) clearTimeout(chromeHideTimerRef.current);
    const v = videoRef.current;
    const playing = v ? !v.paused : !iframePausedRef.current;
    // Auto-hide only while playing and no menus are open.
    if (playing) {
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
      if (locked) return;
      if (mode !== "native" && !isDrivenEmbed) {
        return;
      }
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
    [mode, isDrivenEmbed, locked, seekBy, bumpChrome]
  );

  const handleVideoClick = useCallback(
    (e: React.MouseEvent) => {
      if (locked) return;
      if (mode !== "native" && !isDrivenEmbed) {
        return;
      }
      // Ignore the synthetic click that follows touchend on mobile.
      if (performance.now() - lastTouchChromeRef.current < 500) return;
      // Ignore clicks that originate from chrome buttons (they stopPropagation).
      if ((e.target as HTMLElement).closest("button, input, [role='menu']")) {
        return;
      }
      setChromeVisible((v) => !v);
      bumpChrome();
    },
    [mode, isDrivenEmbed, locked, bumpChrome]
  );

  const handleResume = useCallback(() => {
    const pos = resumePosRef.current || resumePosition || 0;
    setResumeKey(null);
    setResumePosition(null);
    void seekAndArmSaves(pos);
  }, [resumePosition, seekAndArmSaves]);

  const handleRestart = useCallback(() => {
    clearPosition();
    endedRef.current = false;
    lastSavedPosRef.current = 0;
    resumePosRef.current = 0;
    pendingSeekPosRef.current = null;
    const waiters = pendingSeekWaitersRef.current;
    pendingSeekWaitersRef.current = [];
    for (const w of waiters) w(false);
    holdForResumeRef.current = false;
    saveEnabledRef.current = true;
    setResumeKey(null);
    setResumePosition(null);
    void seekVideo(0);
  }, [clearPosition, seekVideo]);

  // Fetch saved position before native playback starts. Block saves and pause
  // autoplay until this resolves so playback cannot start at 0 or wipe a good
  // bookmark while the lookup is pending.
  useEffect(() => {
    const params = playbackParams();
    if (!params) return;
    if (mode === "iframe") {
      // No cross-origin seek API for the embed — resume via its startAt
      // param instead. Always re-read the server bookmark so a dismissed
      // Continue Watching delete wins over stale detail-page props.
      holdForResumeRef.current = false;
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
              saveEnabledRef.current = true;
            } else {
              resumePosRef.current = 0;
              setResumePosition(null);
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
    resumePosRef.current = 0;
    videoRef.current?.pause();

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
    clearPosition,
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
  // IMPORTANT: do not enable saves until seek lands (see seekAndArmSaves).
  const autoResumeStartedRef = useRef(false);
  useEffect(() => {
    if (
      !autoResume ||
      mode !== "native" ||
      resumePosition == null ||
      resumeKey !== playbackParams() ||
      autoResumeStartedRef.current
    ) {
      return;
    }
    autoResumeStartedRef.current = true;
    const position = resumePosition;
    // Clear overlay state in microtask (not sync setState-in-effect).
    queueMicrotask(() => {
      setResumeKey(null);
      setResumePosition(null);
    });
    void seekAndArmSaves(position);
  }, [
    autoResume,
    mode,
    playbackParams,
    resumeKey,
    resumePosition,
    seekAndArmSaves,
  ]);

  // Iframe path: no seek API for the embed, so drop any resume prompt.
  useEffect(() => {
    if (mode !== "iframe") return;
    holdForResumeRef.current = false;
  }, [mode]);

  // ---------- source switching ----------
  // Picker order: vidnest, mapple, cinesrc, 2embed, vidfast, vidlink, then vix.
  // goated stays last and disabled (degraded backend).
  const ALL_SOURCES: StreamSource[] = [
    ...EMBED_SOURCES.map((s) => s.key as StreamSource),
    "vix",
    "goated",
  ];
  const disabledSources: StreamSource[] = [
    "goated",
    ...(type === "tv"
      ? EMBED_SOURCES.filter((s) => !s.tvUrl(0, 1, 1)).map(
          (s) => s.key as StreamSource
        )
      : []),
  ];
  const nextPlayableSource = (current: StreamSource): StreamSource => {
    const blocked = new Set(disabledSources);
    const start = ALL_SOURCES.indexOf(current);
    for (let i = 1; i <= ALL_SOURCES.length; i++) {
      const next = ALL_SOURCES[(start + i) % ALL_SOURCES.length];
      if (next && !blocked.has(next)) return next;
    }
    return current;
  };
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
      pendingSeekPosRef.current = pos;
      // Keep throttle baseline at the real position so tiny pre-seek reports
      // don't pass the min-delta check as "progress".
      lastSavedPosRef.current = pos;
      lastSavedAtRef.current = Date.now();
      // Persist to server before tearing down the video element.
      savePosition(pos, v && Number.isFinite(v.duration) ? v.duration : 0, true);
    } else {
      pendingSeekPosRef.current = null;
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
    setMediaReady(false);
    setIframeCues([]);
    setOpenSubFileId(null);
    // Keep ended/nearEnd so binge overlays don't double-fire after a switch.
    bookmarkClearedRef.current = false;
  }, [activeSource, savePosition]);

  /** Load top-3 OpenSubtitles list once per episode (no download quota). */
  const ensureOpenSubList = useCallback(async () => {
    const imdb = imdbIdRef.current;
    if (!imdb) {
      setOpenSubItems([]);
      return;
    }
    const key = `${imdb}:${season ?? ""}:${episode ?? ""}`;
    if (openSubListKeyRef.current === key && openSubItems.length > 0) return;
    setOpenSubListLoading(true);
    try {
      const items = await listOpenSubtitles({
        imdbId: imdb,
        season,
        episode,
      });
      openSubListKeyRef.current = key;
      setOpenSubItems(items);
    } finally {
      setOpenSubListLoading(false);
    }
  }, [season, episode, openSubItems.length]);

  /** Subtitle source picker: persist choice + re-run the subtitle loader. */
  const handleSubSource = useCallback(
    (next: SubSource) => {
      setSubSource(next);
      // Sync the ref synchronously so the immediate reload reads the NEW
      // source (passive useEffect would run only after the commit).
      subSourceRef.current = next;
      setSubError(null);
      if (next !== "opensub") {
        setOpenSubFileId(null);
        setSubMenuOpen(false);
      }
      // subs mirrors the source so applySettings() can drive off/stream
      // (subs === "off" hides; otherwise the language preference applies).
      saveVixSettings({
        subSource: next,
        subs: next === "off" ? "off" : "en",
      });
      // OpenSubs: keep menu open, list top 3, still load best as default.
      if (next === "opensub") {
        void ensureOpenSubList();
      }
      reloadSubsRef.current?.();
    },
    [ensureOpenSubList]
  );

  // Declared before handleOpenSubPick (used in its deps below).
  const ensureIframeImdb = useCallback(async (): Promise<string | null> => {
    if (imdbIdRef.current) return imdbIdRef.current;
    if (!type || !tmdbId) return null;
    try {
      const res = await fetch(
        `/api/imdb?type=${type}&id=${tmdbId}`
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { imdbId?: string | null };
      if (data.imdbId) imdbIdRef.current = data.imdbId;
      return data.imdbId ?? null;
    } catch {
      return null;
    }
  }, [type, tmdbId]);

  /** User picked one of the top-3 OpenSubtitles files. */
  const handleOpenSubPick = useCallback(
    async (item: OpenSubListItem) => {
      // Clocked iframe: no <video> track — the iframe-sub effect downloads
      // the picked file once openSubFileId is set.
      if (clockEmbed) {
        const imdb = imdbIdRef.current ?? (await ensureIframeImdb());
        if (!imdb) {
          setSubError("Subtitles unavailable");
          return;
        }
        setOpenSubFileId(item.fileId);
        setSubSource("opensub");
        subSourceRef.current = "opensub";
        setSubError(null);
        saveVixSettings({ subSource: "opensub", subs: "en" });
        setSubMenuOpen(false);
        return;
      }
      const video = videoRef.current;
      const imdb = imdbIdRef.current;
      if (!video || !imdb) {
        setSubError("Subtitles unavailable");
        return;
      }
      setOpenSubFileId(item.fileId);
      setSubSource("opensub");
      subSourceRef.current = "opensub";
      setSubError(null);
      saveVixSettings({ subSource: "opensub", subs: "en" });
      const ext = await fetchExternalVtt({
        source: "opensub",
        imdbId: imdb,
        season,
        episode,
        fileId: item.fileId,
        label: item.label,
      });
      if (!ext?.vtt) {
        setSubError("Couldn’t download that subtitle");
        return;
      }
      for (const t of injectedTracksRef.current) t.mode = "disabled";
      injectedTracksRef.current = [];
      externalVttRef.current = { vtt: ext.vtt, label: ext.label };
      setHasExternalSubs(true);
      const delay = loadVixSettings().subDelaySeconds;
      const tr = injectVttTrack(video, ext.vtt, ext.label, true, delay);
      if (tr) injectedTracksRef.current.push(tr);
      setSubMenuOpen(false);
    },
    [season, episode, clockEmbed, ensureIframeImdb]
  );

  // Prefetch OS list when CC menu opens on OpenSubs.
  useEffect(() => {
    if (subMenuOpen && subSource === "opensub") {
      void ensureOpenSubList();
    }
  }, [subMenuOpen, subSource, ensureOpenSubList]);

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
    // Embed sources have no native resolver — mode is already "iframe".
    if (isEmbedActive) return;
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
  }, [streamable, type, tmdbId, season, episode, activeSource, isEmbedActive]);

  // ---------- Driven-embed subtitles (VDRK / OpenSubs overlay) ----------
  // CineSrc hides its CC menu (controls=false) with no subtitle postMessage
  // API; VidFast has no subtitle commands either — so render our own cues
  // over the iframe, synced to its timeupdate position. VDRK needs only TMDB
  // ids; OpenSubs needs an IMDb id (resolved lazily via /api/imdb since
  // embeds never resolve).
  useEffect(() => {
    if (!clockEmbed) return;
    if (subSource === "off" || subSource === "stream") {
      setIframeCues([]);
      return;
    }
    if (!type || !tmdbId) return;
    let cancelled = false;
    void (async () => {
      // Forced OpenSubs (or a picked file): download it directly.
      if (subSource === "opensub") {
        const imdb = await ensureIframeImdb();
        if (cancelled) return;
        if (!imdb) {
          setIframeCues([]);
          setSubError("OpenSubtitles unavailable for this title");
          return;
        }
        // Keep the top-3 list fresh for the picker.
        void ensureOpenSubList();
        const ext = await fetchExternalVtt({
          source: "opensub",
          imdbId: imdb,
          season,
          episode,
          ...(openSubFileId != null ? { fileId: openSubFileId } : {}),
        });
        if (cancelled) return;
        if (!ext?.vtt) {
          setIframeCues([]);
          setSubError("Couldn’t download that subtitle");
          return;
        }
        // Guard: setting state re-runs this effect — only touch the picker
        // id when it actually changed, or best-download loops forever.
        if (ext.fileId != null && ext.fileId !== openSubFileId) {
          setOpenSubFileId(ext.fileId);
        }
        setIframeCues(parseVttCues(ext.vtt));
        setHasExternalSubs(true);
        setSubError(null);
        return;
      }
      // Auto / VDRK: VDRK first (TMDB ids only), then OpenSubs best on Auto.
      const vdrk = await fetchExternalVtt({
        source: "vdrk",
        type,
        tmdbId,
        season,
        episode,
      });
      if (cancelled) return;
      if (vdrk?.vtt) {
        setIframeCues(parseVttCues(vdrk.vtt));
        setHasExternalSubs(true);
        setSubError(null);
        return;
      }
      if (subSource !== "auto") {
        setIframeCues([]);
        setSubError("VDRK subtitles unavailable for this episode");
        return;
      }
      const imdb = await ensureIframeImdb();
      if (cancelled) return;
      if (!imdb) {
        setIframeCues([]);
        setSubError("Subtitles unavailable for this episode");
        return;
      }
      const os = await fetchExternalVtt({ source: "opensub", imdbId: imdb, season, episode });
      if (cancelled) return;
      if (!os?.vtt) {
        setIframeCues([]);
        setSubError("Subtitles unavailable for this episode");
        return;
      }
      setIframeCues(parseVttCues(os.vtt));
      setHasExternalSubs(true);
      setSubError(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    clockEmbed,
    subSource,
    openSubFileId,
    type,
    tmdbId,
    season,
    episode,
    ensureIframeImdb,
    ensureOpenSubList,
  ]);

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
      pendingSeekPosRef,
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
      onPendingSeekSettled,
    });
  }, [
    mode,
    playlistUrl,
    savePosition,
    season,
    episode,
    activeSource,
    tmdbId,
    type,
    revertExternalSub,
    onPendingSeekSettled,
  ]);


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
      // Closing during startAt warmup must not overwrite with a 0–5s report.
      // A real backward scrub is a new bookmark and must flush.
      if (isPreSeekNoise(remotePositionRef.current, resumePosRef.current)) {
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
    setMediaReady(false);

    const syncTransport = () => {
      setTransport({
        currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        paused: video.paused,
        muted: video.muted,
        volume: Number.isFinite(video.volume) ? video.volume : 1,
      });
    };

    const markReady = () => {
      if (video.readyState >= 2) setMediaReady(true);
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
      const t = video.currentTime;
      const pending = pendingSeekPosRef.current;
      if (
        pending != null &&
        Number.isFinite(t) &&
        Math.abs(t - pending) > 2.5
      ) {
        pendingSeekPosRef.current = null;
        resumePosRef.current = 0;
        const waiters = pendingSeekWaitersRef.current;
        pendingSeekWaitersRef.current = [];
        for (const w of waiters) w(true);
      }
      savePosition(t, video.duration, true);
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
    markReady();
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("ended", onEnded);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("volumechange", onVol);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("durationchange", onMeta);
    video.addEventListener("loadeddata", markReady);
    video.addEventListener("canplay", markReady);
    video.addEventListener("playing", markReady);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("volumechange", onVol);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("durationchange", onMeta);
      video.removeEventListener("loadeddata", markReady);
      video.removeEventListener("canplay", markReady);
      video.removeEventListener("playing", markReady);
      setMediaReady(false);
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
    if (isDrivenEmbed) {
      if (activeSource === "cinesrc") {
        sendCineSrcCommand(
          iframeRef.current,
          iframePausedRef.current ? "play" : "pause"
        );
      } else {
        sendVidfastCommand(
          iframeRef.current,
          iframePausedRef.current ? "play" : "pause"
        );
      }
      bumpChrome();
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
    bumpChrome();
  }, [isDrivenEmbed, activeSource, bumpChrome]);

  const seekBySeconds = useCallback(
    (delta: number) => {
      if (isDrivenEmbed) {
        sendEmbedSeek(
          clampEmbedTime(remotePositionRef.current + delta)
        );
        bumpChrome();
        return;
      }
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.currentTime)) return;
      const dur =
        Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
      const target = Math.max(0, v.currentTime + delta);
      v.currentTime = dur == null ? target : Math.min(target, dur);
      bumpChrome();
    },
    [isDrivenEmbed, sendEmbedSeek, bumpChrome]
  );

  const seekRatio = useCallback(
    (ratio: number) => {
      if (isDrivenEmbed) {
        const dur = remoteDurationRef.current;
        if (!(dur > 0)) return;
        sendEmbedSeek(Math.max(0, Math.min(dur, ratio * dur)));
        bumpChrome();
        return;
      }
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
      v.currentTime = Math.max(0, Math.min(v.duration, ratio * v.duration));
      bumpChrome();
    },
    [isDrivenEmbed, sendEmbedSeek, bumpChrome]
  );

  const toggleMute = useCallback(() => {
    if (isDrivenEmbed) {
      const next = !iframeMutedRef.current;
      iframeMutedRef.current = next;
      if (activeSource === "cinesrc") {
        sendCineSrcCommand(iframeRef.current, "setMuted", [next]);
      } else {
        // VidFast has no mute command — drive it through volume.
        const level = next ? 0 : loadVixSettings().volume || 1;
        sendVidfastCommand(iframeRef.current, "volume", { level });
      }
      setTransport((t) => ({ ...t, muted: next }));
      bumpChrome();
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    // Session-only mute — never persisted (see vix-settings).
    v.muted = !v.muted;
    bumpChrome();
  }, [isDrivenEmbed, activeSource, bumpChrome]);

  const setVolume = useCallback(
    (vol: number) => {
      const next = Math.max(0, Math.min(1, vol));
      if (isDrivenEmbed) {
        iframeMutedRef.current = next === 0;
        if (activeSource === "cinesrc") {
          sendCineSrcCommand(iframeRef.current, "setVolume", [next]);
          sendCineSrcCommand(iframeRef.current, "setMuted", [next === 0]);
        } else {
          sendVidfastCommand(iframeRef.current, "volume", { level: next });
        }
        setTransport((t) => ({ ...t, volume: next, muted: next === 0 }));
        saveVixSettings({ volume: next });
        bumpChrome();
        return;
      }
      const v = videoRef.current;
      if (!v) return;
      v.volume = next;
      v.muted = next === 0;
      saveVixSettings({ volume: next });
      bumpChrome();
    },
    [isDrivenEmbed, activeSource, bumpChrome]
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
      // CineSrc posts cinesrc:* instead of PLAYER_EVENT — normalize the 5
      // events the bridge already consumes.
      let data: unknown = e.data;
      if (
        e.origin === "https://cinesrc.st" &&
        typeof e.data === "object" &&
        e.data !== null
      ) {
        const rawType = (e.data as { type?: unknown }).type;
        if (typeof rawType === "string" && rawType.startsWith("cinesrc:")) {
          const ev = rawType.slice("cinesrc:".length);
          const payload = e.data as {
            currentTime?: unknown;
            duration?: unknown;
            volume?: unknown;
            muted?: unknown;
            playbackRate?: unknown;
          };
          if (ev === "ready" || ev === "loadedmetadata") {
            setMediaReady(true);
          }
          if (ev === "ratechange" && typeof payload.playbackRate === "number") {
            const rate = payload.playbackRate;
            if (Number.isFinite(rate) && rate > 0) {
              setPlaybackSpeed(rate);
              saveVixSettings({ speed: rate });
            }
          }
          if (ev === "volumechange") {
            if (typeof payload.muted === "boolean") {
              iframeMutedRef.current = payload.muted;
            }
            setTransport((t) => ({
              ...t,
              volume:
                typeof payload.volume === "number" ? payload.volume : t.volume,
              muted:
                typeof payload.muted === "boolean" ? payload.muted : t.muted,
            }));
          }
          if (
            (["play", "pause", "seeked", "ended", "timeupdate"] as const).includes(
              ev as "play"
            )
          ) {
            if (ev === "play") iframePausedRef.current = false;
            if (ev === "pause" || ev === "ended") iframePausedRef.current = true;
            if (ev === "play" || ev === "timeupdate") setMediaReady(true);
            setTransport((t) => ({
              ...t,
              currentTime:
                typeof payload.currentTime === "number"
                  ? payload.currentTime
                  : t.currentTime,
              duration:
                typeof payload.duration === "number"
                  ? payload.duration
                  : t.duration,
              paused:
                ev === "play"
                  ? false
                  : ev === "pause" || ev === "ended"
                    ? true
                    : t.paused,
            }));
            if (ev === "play") bumpChrome();
            if (ev === "pause") {
              setChromeVisible(true);
              if (chromeHideTimerRef.current) {
                clearTimeout(chromeHideTimerRef.current);
              }
            }
            data = {
              type: "PLAYER_EVENT",
              data: {
                event: ev,
                currentTime:
                  typeof payload.currentTime === "number"
                    ? payload.currentTime
                    : undefined,
                duration:
                  typeof payload.duration === "number"
                    ? payload.duration
                    : undefined,
              },
            };
          }
        }
      }
      const isPlayerEvent =
        typeof data === "object" &&
        data !== null &&
        (data as { type?: unknown }).type === "PLAYER_EVENT";
      // Nested player frames post from inner windows, so trust any registered
      // embed player origin instead of requiring the exact embed frame/source.
      if (!isEmbedPlayerOrigin(e.origin)) {
        if (isPlayerEvent && !loggedRejectedOrigin) {
          loggedRejectedOrigin = true;
          console.warn(
            "[player] PLAYER_EVENT from origin",
            e.origin,
            "ignored (expected registered embed source)"
          );
        }
        return;
      }
      // VidFast enriches PLAYER_EVENT payloads with live state
      // ({ playing, muted, volume }) — read extras once for the blocks below.
      // Its playerstatus reply (getStatus) is outside the 5-event whitelist,
      // so sync from it here and stop before the progress-save path.
      const vfState =
        activeSource === "vidfast" &&
        typeof data === "object" &&
        data !== null &&
        typeof (data as { data?: unknown }).data === "object" &&
        (data as { data?: unknown }).data !== null
          ? ((data as { data?: unknown }).data as {
              event?: unknown;
              playing?: unknown;
              muted?: unknown;
              volume?: unknown;
            })
          : null;
      if (vfState?.event === "playerstatus") {
        const st = vfState as {
          currentTime?: unknown;
          duration?: unknown;
          playing?: unknown;
          muted?: unknown;
          volume?: unknown;
        };
        if (typeof st.currentTime === "number") {
          remotePositionRef.current = st.currentTime;
        }
        if (typeof st.duration === "number" && st.duration > 0) {
          remoteDurationRef.current = st.duration;
        }
        if (typeof st.muted === "boolean") iframeMutedRef.current = st.muted;
        if (typeof st.playing === "boolean") {
          iframePausedRef.current = !st.playing;
        }
        if (
          typeof st.currentTime === "number" ||
          typeof st.duration === "number"
        ) {
          setMediaReady(true);
        }
        setTransport((t) => ({
          ...t,
          currentTime:
            typeof st.currentTime === "number" ? st.currentTime : t.currentTime,
          duration:
            typeof st.duration === "number" && st.duration > 0
              ? st.duration
              : t.duration,
          paused:
            typeof st.playing === "boolean" ? !st.playing : t.paused,
          muted: typeof st.muted === "boolean" ? st.muted : t.muted,
          volume: typeof st.volume === "number" ? st.volume : t.volume,
        }));
        return;
      }

      const d = parseVixPlayerEventData(data);
      if (!d) return;
      emit(d.event);

      if (typeof d.currentTime === "number") {
        remotePositionRef.current = d.currentTime;
      }
      if (typeof d.duration === "number" && d.duration > 0) {
        remoteDurationRef.current = d.duration;
      }

      // VidFast drives our transport like CineSrc (play/pause/seek/volume).
      // Other PLAYER_EVENT embeds (Mapple/VidLink/2Embed/vixsrc fallback) only
      // feed progress below — their chrome stays in charge until locked.
      if (
        activeSource === "vidfast" &&
        (d.event === "play" ||
          d.event === "pause" ||
          d.event === "seeked" ||
          d.event === "ended" ||
          d.event === "timeupdate")
      ) {
        // Prefer the payload's live state (autoplay-muted starts never fire
        // a mute event, so event names alone lie about sound).
        const livePlaying =
          typeof vfState?.playing === "boolean" ? vfState.playing : null;
        const liveMuted =
          typeof vfState?.muted === "boolean" ? vfState.muted : null;
        const liveVolume =
          typeof vfState?.volume === "number" ? vfState.volume : null;
        if (livePlaying != null) iframePausedRef.current = !livePlaying;
        else if (d.event === "play") iframePausedRef.current = false;
        else if (d.event === "pause" || d.event === "ended") {
          iframePausedRef.current = true;
        }
        if (liveMuted != null) iframeMutedRef.current = liveMuted;
        if (d.event === "play" || d.event === "timeupdate") setMediaReady(true);
        setTransport((t) => ({
          ...t,
          currentTime:
            typeof d.currentTime === "number" ? d.currentTime : t.currentTime,
          duration:
            typeof d.duration === "number" && d.duration > 0
              ? d.duration
              : t.duration,
          paused:
            livePlaying != null
              ? !livePlaying
              : d.event === "play"
                ? false
                : d.event === "pause" || d.event === "ended"
                  ? true
                  : t.paused,
          muted: liveMuted ?? t.muted,
          volume: liveVolume ?? t.volume,
        }));
        if (d.event === "play") bumpChrome();
        if (d.event === "pause") {
          setChromeVisible(true);
          if (chromeHideTimerRef.current) {
            clearTimeout(chromeHideTimerRef.current);
          }
        }
      }

      // Mapple has no command channel — sync only the clock so our subtitle
      // overlay can follow it. Transport stays hidden; its player owns control.
      if (
        mappleEmbed &&
        (d.event === "timeupdate" || d.event === "seeked")
      ) {
        if (
          typeof d.currentTime === "number" ||
          typeof d.duration === "number"
        ) {
          setMediaReady(true);
        }
        setTransport((t) => ({
          ...t,
          currentTime:
            typeof d.currentTime === "number" ? d.currentTime : t.currentTime,
          duration:
            typeof d.duration === "number" && d.duration > 0
              ? d.duration
              : t.duration,
        }));
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

      // Resume gate: startAt can report 0–5s before the embed seeks. A
      // backward scrub (43:00 → 3:00) is the new bookmark — keep it.
      if (resumePosRef.current > 0) {
        if (remotePositionRef.current >= resumePosRef.current - 1) {
          resumePosRef.current = 0;
        } else if (isPreSeekNoise(remotePositionRef.current, resumePosRef.current)) {
          return;
        } else {
          resumePosRef.current = 0;
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
  }, [activeSource, bumpChrome, clearPosition, emit, savePosition]);

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

  const isLoading = mode === "loading" || (mode === "native" && !mediaReady);
  const hasError = mode === "error";
  const playbackKey = playbackParams();
  const showResume =
    mode === "native" &&
    mediaReady &&
    !autoResume &&
    resumePosition != null &&
    resumeKey === playbackKey;
  const iframeBaseSrc =
    type && tmdbId
      ? embedUrlFor(activeSource, type, tmdbId, season, episode) ?? src
      : src;
  const iframeSrc = addStartAt(iframeBaseSrc, resumePosition);
  // Transport only after media can play — otherwise black screen + fake pause/±10.
  const cineSrcEmbed = mode === "iframe" && activeSource === "cinesrc";
  const showTransport =
    !locked &&
    chromeVisible &&
    (mode === "native" || isDrivenEmbed) &&
    mediaReady &&
    !showResume &&
    !resumeSeeking;

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

      {clockEmbed && subSource !== "off" && subSource !== "stream" && (
        <IframeSubtitleOverlay
          text={cueTextAt(iframeCues, transport.currentTime - subDelay)}
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
          // No allow-popups / allow-top-navigation: embed ads cannot open
          // scam popups or redirect the page. Scripts + same-origin storage
          // keep playback working; postMessage is unaffected by sandboxing.
          sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
          onLoad={() => {
            setIframeError(false);
            // VidFast starts muted under autoplay policy with no
            // unsolicited state event — pull the real state on every load.
            if (vidfastEmbed) {
              sendVidfastCommand(iframeRef.current, "getStatus");
            }
          }}
          onError={() => setIframeError(true)}
          className={`h-full w-full border-0 bg-black ${
            locked || isDrivenEmbed ? "pointer-events-none" : ""
          }`}
        />
      )}

      {isDrivenEmbed && !locked && (
        <div
          className="absolute inset-0 z-[15]"
          onTouchEnd={handleTap}
          onClick={handleVideoClick}
        />
      )}

      {mode === "iframe" && locked && (
        <div className="absolute inset-0 z-30" aria-hidden="true" />
      )}

      {showResume && (
        <ResumeOverlay
          positionSeconds={resumePosition ?? 0}
          onResume={handleResume}
          onRestart={handleRestart}
        />
      )}

      {showTransport && (
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
          isLoading={isLoading || (mode === "native" && !mediaReady)}
          playbackSpeed={playbackSpeed}
          onCycleSpeed={() => {
            // CineSrc is the only embed with a rate API; VidFast has none,
            // so the speed button stays CineSrc/native-only (see top chrome).
            const speeds = [0.75, 1, 1.25, 1.5, 2];
            const idx = speeds.indexOf(playbackSpeed);
            const next =
              idx >= 0
                ? (speeds[(idx + 1) % speeds.length] ?? 1)
                : (speeds.find((s) => s > playbackSpeed) ?? 1);
            setPlaybackSpeed(next);
            saveVixSettings({ speed: next });
            if (cineSrcEmbed) {
              sendCineSrcCommand(iframeRef.current, "setPlaybackRate", [next]);
              return;
            }
            const v = videoRef.current;
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
          openSubItems={openSubItems}
          openSubFileId={openSubFileId}
          openSubListLoading={openSubListLoading}
          onOpenSubPick={(item) => {
            void handleOpenSubPick(item);
          }}
          hasExternalSubs={hasExternalSubs}
          subDelay={subDelay}
          onAdjustSubDelay={adjustSubDelay}
          subFontSize={subFontSize}
          subColor={subColor}
          subBgOpacity={subBgOpacity}
          onPatchSubStyle={patchSubStyle}
          subError={subError}
          onSwitchSource={() => {
            switchSource(nextPlayableSource(activeSource));
          }}
          onPickSource={(source) => switchSource(source)}
          sourceOptions={ALL_SOURCES}
          disabledSources={disabledSources}
          showAutoplayToggle={type === "tv"}
          autoplayNext={autoplayNext}
          onToggleAutoplayNext={() => {
            setAutoplayNext((prev) => {
              const next = !prev;
              saveVixSettings({ autoplayNext: next });
              return next;
            });
          }}
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

      {mode === "iframe" && !locked && !isDrivenEmbed && <EmbedHint />}

      {(mode === "native" || isDrivenEmbed) && tapCue && (
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
            Loading {sourceLabel(activeSource)}…
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
                onClick={() => {
                  switchSource(nextPlayableSource(activeSource));
                }}
                className="mt-4 inline-flex items-center rounded-full bg-primary px-4 py-2 text-sm font-bold text-black"
              >
                Try {sourceLabel(nextPlayableSource(activeSource))}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
