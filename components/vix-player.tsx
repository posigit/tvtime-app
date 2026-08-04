"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { ExternalLink, LoaderCircle, X } from "lucide-react";
import { VIX_PLAYER_ORIGIN, parseVixPlayerEvent, parseVixPlayerEventData } from "@/lib/vixsrc";
import { ResumeOverlay } from "@/components/resume-overlay";
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

function parseVttTime(t: string): number {
  const parts = t.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/** Inject an external VTT as a native text track (shows in the CC menu). */
function injectVttTrack(
  video: HTMLVideoElement,
  vtt: string,
  label: string,
  show: boolean
) {
  const track = video.addTextTrack("subtitles", label, "en");
  track.mode = show ? "showing" : "disabled";
  const lines = vtt.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(
      /(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})/
    );
    if (m) {
      const start = parseVttTime(m[1]);
      const end = parseVttTime(m[2]);
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
  const imdbIdRef = useRef<string | null>(null);
  const mediaKeyRef = useRef<string | null>(null);
  const lastSavedPosRef = useRef(0);
  const onEventRef = useRef(onEvent);
  const onCloseRef = useRef(onClose);
  const endedRef = useRef(false);
  const lastTimeRef = useRef(0);

  const streamable = type === "movie" || type === "tv";
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null);
  // Non-streamable mounts (no type/tmdbId) go straight to iframe fallback.
  const [streamFailed, setStreamFailed] = useState(() => !streamable);
  const [iframeError, setIframeError] = useState(false);
  const [resumePosition, setResumePosition] = useState<number | null>(null);

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

  // ---------- resume playback ----------

  const playbackParams = useCallback(() => {
    const key = mediaKeyRef.current;
    if (!key) return null;
    const [type, ...rest] = key.split(":");
    if (type === "tv" && rest.length >= 3) {
      return `type=tv&id=${rest[0]}&season=${rest[1]}&episode=${rest[2]}`;
    }
    return `type=movie&id=${rest[0]}`;
  }, []);

  const savePosition = useCallback(
    (pos: number, duration: number, force = false) => {
      const params = playbackParams();
      if (!params) return;
      const rounded = Math.round(pos);
      if (rounded <= 0) return;
      if (!force && Math.abs(rounded - lastSavedPosRef.current) < 5) return;
      lastSavedPosRef.current = rounded;
      void fetch(`/api/playback?${params}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positionSeconds: rounded,
          durationSeconds: Math.round(duration || 0),
        }),
        keepalive: true, // survives close/unmount
      }).catch(() => {});
    },
    [playbackParams]
  );

  const clearPosition = useCallback(() => {
    const params = playbackParams();
    if (!params) return;
    void fetch(`/api/playback?${params}`, {
      method: "DELETE",
      keepalive: true,
    }).catch(() => {});
  }, [playbackParams]);

  const seekVideo = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    const doSeek = () => {
      v.currentTime = t;
      void v.play().catch(() => {});
    };
    if (v.readyState >= 1) doSeek();
    else v.addEventListener("loadedmetadata", doSeek, { once: true });
  }, []);

  const handleResume = useCallback(() => {
    if (resumePosition != null) {
      lastSavedPosRef.current = Math.round(resumePosition);
      seekVideo(resumePosition);
    }
    setResumePosition(null);
  }, [resumePosition, seekVideo]);

  const handleRestart = useCallback(() => {
    clearPosition();
    lastSavedPosRef.current = 0;
    seekVideo(0);
    setResumePosition(null);
  }, [clearPosition, seekVideo]);

  // Fetch saved position once native playback starts.
  useEffect(() => {
    if (mode !== "native" || !playlistUrl) return;
    const params = playbackParams();
    if (!params) return;
    let cancelled = false;
    fetch(`/api/playback?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          data: { positionSeconds?: number; durationSeconds?: number } | null
        ) => {
          if (cancelled || !data?.positionSeconds) return;
          const pos = data.positionSeconds;
          const dur = data.durationSeconds || 0;
          // Resume only if meaningfully mid-way; near-complete counts as done.
          if (pos > 30 && (dur === 0 || pos < dur * 0.92)) {
            setResumePosition(pos);
          }
        }
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mode, playlistUrl, playbackParams]);

  // ---------- resolve native stream (single fetch, single source of truth) ----------
  useEffect(() => {
    if (!streamable || !tmdbId) return; // initial state already fell back
    let cancelled = false;
    const params = new URLSearchParams({ type: type!, id: String(tmdbId) });
    if (season != null) params.set("season", String(season));
    if (episode != null) params.set("episode", String(episode));

    fetch(`/api/vixsrc/stream?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("route"))))
      .then((data: { playlistUrl?: string; imdbId?: string | null }) => {
        if (cancelled) return;
        imdbIdRef.current = data?.imdbId ?? null;
        mediaKeyRef.current =
          type === "tv"
            ? `tv:${tmdbId}:${season ?? 0}:${episode ?? 0}`
            : `movie:${tmdbId}`;
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
      hls.loadSource(playlistUrl);
      hls.attachMedia(video);

      // hls.js populates audio/subtitle tracks AFTER MANIFEST_PARSED (lazy).
      // So: try on every track-population event, but only until the user
      // makes a live choice (userTouched) so we never stomp their selection.
      let userTouched = false;
      let everApplied = false;
      let applying = false;

      const applySettings = () => {
        if (!hls) return;
        const s = loadVixSettings();

        const at = hls.audioTracks.find((t) => matchLang(t.lang, s.audio));
        if (at && hls.audioTrack !== at.id) {
          applying = true;
          hls.audioTrack = at.id;
          applying = false;
        }

        hls.subtitleDisplay = s.subs !== "off";
        if (s.subs === "off") {
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
          } else {
            // Saved language not in this stream (e.g. no English CC) — show
            // NO subs rather than letting hls auto-pick an unwanted track.
            hls.subtitleDisplay = false;
            if (hls.subtitleTrack !== -1) {
              applying = true;
              hls.subtitleTrack = -1;
              applying = false;
            }
          }
        }

        if (typeof s.quality === "number") {
          const li = hls.levels.findIndex((lv) => lv.height === s.quality);
          if (li >= 0 && hls.currentLevel !== li) hls.currentLevel = li;
        }

        video.playbackRate = s.speed;
        video.volume = s.volume;
        video.muted = s.muted;
        // Only counts as "applied" once tracks actually exist — otherwise the
        // empty MANIFEST_PARSED run would let early internal switches poison.
        if (hls.audioTracks.length > 0 || hls.subtitleTracks.length > 0) {
          everApplied = true;
        }
      };

      // First attempt at manifest parse (usually empty — harmless), then
      // re-apply whenever the track lists actually populate.
      hls.on(Hls.Events.MANIFEST_PARSED, applySettings);
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        if (!userTouched) applySettings();
      });

      // OpenSubtitles fallback: only when the stream has NO English CC.
      let osLoaded = false;
      const maybeLoadOpenSubtitles = async () => {
        if (osLoaded || !hls || !imdbIdRef.current) return;
        const hasEng = hls.subtitleTracks.some((t) => matchLang(t.lang, "en"));
        if (hasEng) return; // vixsrc already has English CC — prefer it
        osLoaded = true;
        try {
          const q = new URLSearchParams({
            imdbId: imdbIdRef.current,
            lang: "en",
          });
          if (season != null) q.set("season", String(season));
          if (episode != null) q.set("episode", String(episode));
          const res = await fetch(`/api/vixsrc/subs?${q.toString()}`);
          if (!res.ok) return;
          const data = (await res.json()) as { vtt?: string; label?: string };
          if (!data.vtt) return;
          const show = loadVixSettings().subs !== "off";
          injectVttTrack(
            video,
            data.vtt,
            data.label ?? "OpenSubtitles (English)",
            show
          );
        } catch {
          /* non-fatal */
        }
      };

      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
        if (!userTouched) applySettings();
        void maybeLoadOpenSubtitles();
      });

      // Persist user changes (and ignore switches caused by our own apply
      // or hls.js internals during initial load).
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_evt, data) => {
        if (applying || !everApplied) return;
        userTouched = true;
        const t = hls?.audioTracks.find((x) => x.id === data.id);
        saveVixSettings({ audio: t?.lang || "en" });
      });
      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_evt, data) => {
        if (applying || !everApplied) return;
        userTouched = true;
        const t = hls?.subtitleTracks.find((x) => x.id === data.id);
        saveVixSettings({ subs: t ? t.lang : "off" });
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, data) => {
        if (applying) return;
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
      for (const fn of cleanup) fn();
    };
  }, [mode, playlistUrl, season, episode]);

  // ---------- native video -> event bridge ----------
  useEffect(() => {
    if (mode !== "native" || !videoRef.current) return;
    const video = videoRef.current;

    const onPlay = () => emit("play");
    const onPause = () => {
      emit("pause");
      savePosition(video.currentTime, video.duration, true);
    };
    const onSeeked = () => {
      emit("seeked");
      savePosition(video.currentTime, video.duration, true);
    };
    const onEnded = () => {
      emit("ended");
      clearPosition();
    };
    const onTime = () => {
      const now = Date.now();
      if (now - lastTimeRef.current < 1000) return;
      lastTimeRef.current = now;
      emit("timeupdate");
      savePosition(video.currentTime, video.duration);
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
  }, [mode, emit, savePosition, clearPosition]);

  // ---------- iframe fallback: postMessage bridge ----------
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.origin !== VIX_PLAYER_ORIGIN) return;
      const event = parseVixPlayerEvent(e.data);
      if (!event) return;
      emit(event);
      // iframe fallback: persist progress from the remote player's timeupdate.
      const d = parseVixPlayerEventData(e.data);
      if (
        d?.event === "timeupdate" &&
        typeof d.currentTime === "number" &&
        d.currentTime > 0
      ) {
        savePosition(d.currentTime, d.duration ?? 0);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [emit, savePosition]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const v = videoRef.current;
        if (v) savePosition(v.currentTime, v.duration, true);
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [savePosition]);

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

      {mode === "native" && resumePosition != null && (
        <ResumeOverlay
          positionSeconds={resumePosition}
          onResume={handleResume}
          onRestart={handleRestart}
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
              onClick={() => {
                const v = videoRef.current;
                if (v) savePosition(v.currentTime, v.duration, true);
                onClose();
              }}
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
