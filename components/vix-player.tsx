"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { ExternalLink, LoaderCircle, X } from "lucide-react";
import { VIX_PLAYER_ORIGIN, parseVixPlayerEvent } from "@/lib/vixsrc";
import {
  loadVixSettings,
  saveVixSettings,
  matchLang,
} from "@/lib/vix-settings";

/** Safari-only audio-track API — not present in TS's DOM lib. */
type NativeAudioTrack = { language: string; enabled: boolean };
type NativeAudioTrackList = {
  length: number;
  [index: number]: NativeAudioTrack;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

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
  type,
  tmdbId,
  season,
  episode,
}: {
  src: string;
  title: string;
  onEvent?: (event: string) => void;
  onClose: () => void;
  type?: "movie" | "tv";
  tmdbId?: number;
  season?: number;
  episode?: number;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const onEventRef = useRef(onEvent);
  const onCloseRef = useRef(onClose);
  const endedRef = useRef(false);
  const lastTimeRef = useRef(0);

  const streamable = type === "movie" || type === "tv";
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null);
  // Non-streamable mounts (no type/tmdbId) go straight to iframe fallback.
  const [streamFailed, setStreamFailed] = useState(() => !streamable);
  const [iframeError, setIframeError] = useState(false);

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
    endedRef.current = false;
  }, [src]);

  const emit = useCallback((event: string) => {
    if (event === "ended") {
      if (endedRef.current) return;
      endedRef.current = true;
    }
    onEventRef.current?.(event);
  }, []);

  // ---------- resolve native stream (single fetch, single source of truth) ----------
  useEffect(() => {
    if (!streamable || !tmdbId) return; // initial state already fell back
    let cancelled = false;
    const params = new URLSearchParams({ type: type!, id: String(tmdbId) });
    if (season != null) params.set("season", String(season));
    if (episode != null) params.set("episode", String(episode));

    fetch(`/api/vixsrc/stream?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("route"))))
      .then((data: { playlistUrl?: string }) => {
        if (cancelled) return;
        if (data?.playlistUrl) setPlaylistUrl(data.playlistUrl);
        else setStreamFailed(true);
      })
      .catch(() => {
        if (!cancelled) setStreamFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [streamable, type, tmdbId, season, episode]);

  // ---------- native playback (hls.js / Safari native) ----------
  useEffect(() => {
    if (mode !== "native" || !playlistUrl || !videoRef.current) return;
    const video = videoRef.current;
    let hls: Hls | null = null;
    const cleanup: Array<() => void> = [];

    if (Hls.isSupported()) {
      hls = new Hls();
      hlsRef.current = hls;
      hls.loadSource(playlistUrl);
      hls.attachMedia(video);

      // Apply persisted settings once the manifest (and its tracks) are parsed.
      const applySettings = () => {
        if (!hls) return;
        const s = loadVixSettings();

        const at = hls.audioTracks.find((t) => matchLang(t.lang, s.audio));
        if (at) hls.audioTrack = at.id;

        hls.subtitleDisplay = s.subs !== "off";
        if (s.subs === "off") {
          hls.subtitleTrack = -1;
        } else {
          const st = hls.subtitleTracks.find((t) =>
            matchLang(t.lang, s.subs)
          );
          if (st) hls.subtitleTrack = st.id;
        }

        if (typeof s.quality === "number") {
          const li = hls.levels.findIndex((lv) => lv.height === s.quality);
          if (li >= 0) hls.currentLevel = li;
        }

        video.playbackRate = s.speed;
        video.volume = s.volume;
        video.muted = s.muted;
      };

      hls.on(Hls.Events.MANIFEST_PARSED, applySettings);
      // Tracks can land after MANIFEST_PARSED; only apply again if the user
      // hasn't already picked something (keeps live choices from being stomped).
      const applyIfUnset = () => {
        if (!hls) return;
        if (hls.subtitleTrack < 0) applySettings();
      };
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, applyIfUnset);
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, applyIfUnset);

      // Persist user changes.
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_evt, data) => {
        const t = hls?.audioTracks.find((x) => x.id === data.id);
        saveVixSettings({ audio: t?.lang || "en" });
      });
      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_evt, data) => {
        const t = hls?.subtitleTracks.find((x) => x.id === data.id);
        saveVixSettings({ subs: t ? t.lang : "off" });
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, data) => {
        const lv = hls?.levels[data.level];
        saveVixSettings({ quality: lv?.height ?? "auto" });
      });

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls?.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls?.recoverMediaError();
        } else {
          setStreamFailed(true);
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari / native HLS: persist + restore via the native track lists.
      video.src = playlistUrl;

      const s = loadVixSettings();
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
              t.mode = matchLang(t.language, s.subs) ? "showing" : "hidden";
            }
          }
        }
        video.playbackRate = s.speed;
        video.volume = s.volume;
        video.muted = s.muted;
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
        if (tt) {
          for (let i = 0; i < tt.length; i++) {
            const t = tt[i];
            if (
              (t.kind === "subtitles" || t.kind === "captions") &&
              t.mode === "showing"
            ) {
              subs = t.language;
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
    } else {
      setStreamFailed(true);
    }

    // Speed + volume persist on both paths.
    const onRate = () => saveVixSettings({ speed: video.playbackRate });
    const onVol = () =>
      saveVixSettings({ volume: video.volume, muted: video.muted });
    video.addEventListener("ratechange", onRate);
    video.addEventListener("volumechange", onVol);
    cleanup.push(() => {
      video.removeEventListener("ratechange", onRate);
      video.removeEventListener("volumechange", onVol);
    });

    return () => {
      hls?.destroy();
      hlsRef.current = null;
      for (const fn of cleanup) fn();
    };
  }, [mode, playlistUrl]);

  // ---------- native video -> event bridge ----------
  useEffect(() => {
    if (mode !== "native" || !videoRef.current) return;
    const video = videoRef.current;

    const onPlay = () => emit("play");
    const onPause = () => emit("pause");
    const onSeeked = () => emit("seeked");
    const onEnded = () => emit("ended");
    const onTime = () => {
      const now = Date.now();
      if (now - lastTimeRef.current < 1000) return;
      lastTimeRef.current = now;
      emit("timeupdate");
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("ended", onEnded);
    video.addEventListener("timeupdate", onTime);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("timeupdate", onTime);
    };
  }, [mode, emit]);

  // ---------- iframe fallback: postMessage bridge ----------
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.origin !== VIX_PLAYER_ORIGIN) return;
      const event = parseVixPlayerEvent(e.data);
      if (!event) return;
      emit(event);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [emit]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const isLoading = mode === "loading";
  const hasError = mode === "error";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} player`}
      className="fixed inset-0 z-[100] flex flex-col bg-black"
    >
      {mode === "native" && (
        <video
          ref={videoRef}
          controls
          autoPlay
          playsInline
          className="h-full w-full bg-black"
        />
      )}

      {mode === "iframe" && (
        <iframe
          key={src}
          ref={iframeRef}
          src={src}
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

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/90 via-black/45 to-transparent pt-safe">
        <div className="flex items-start justify-between gap-3 px-4 pb-8 pt-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">{title}</p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
              VixSrc
            </p>
          </div>
          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-9 items-center gap-1.5 rounded-full bg-black/60 px-3 text-xs font-bold text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80"
              aria-label="Open player in browser"
            >
              <ExternalLink className="h-4 w-4" />
              <span className="hidden sm:inline">Open in browser</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close player"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center text-white/70">
          <div className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-xs font-semibold backdrop-blur">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Loading player…
          </div>
        </div>
      )}

      {hasError && (
        <div className="absolute inset-0 z-[6] flex items-center justify-center bg-black/85 p-6 text-center">
          <div>
            <p className="font-bold text-white">Player unavailable here</p>
            <p className="mt-1 text-sm text-white/55">
              Try opening it in your browser instead.
            </p>
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-black"
            >
              <ExternalLink className="h-4 w-4" />
              Open player
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
