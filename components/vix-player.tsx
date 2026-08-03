"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, LoaderCircle, X } from "lucide-react";
import {
  VIX_PLAYER_ORIGIN,
  parseVixPlayerEvent,
} from "@/lib/vixsrc";

/**
 * Full-screen VixSrc player overlay.
 *
 * Embeds the VixSrc player iframe and forwards its postMessage events:
 * "PLAYER_EVENT" with event names play/pause/seeked/ended/timeupdate.
 * Callers subscribe via `onEvent` (e.g. auto-mark watched on "ended").
 */
export function VixPlayer({
  src,
  title,
  onEvent,
  onClose,
}: {
  src: string;
  title: string;
  onEvent?: (event: string) => void;
  onClose: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onEventRef = useRef(onEvent);
  const onCloseRef = useRef(onClose);
  const endedRef = useRef(false);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const isLoading = loadedSrc !== src && failedSrc !== src;
  const hasError = failedSrc === src;

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    endedRef.current = false;
  }, [src]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.origin !== VIX_PLAYER_ORIGIN) return;

      const event = parseVixPlayerEvent(e.data);
      if (!event) return;
      if (event === "ended") {
        if (endedRef.current) return;
        endedRef.current = true;
      }
      onEventRef.current?.(event);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} player`}
      className="fixed inset-0 z-[100] flex flex-col bg-black"
    >
      <iframe
        key={src}
        ref={iframeRef}
        src={src}
        title={title}
        // vixsrc.to WAF blocks referers from *.vercel.app — strip it so the
        // player loads on Vercel-hosted prod (localhost is allowed).
        referrerPolicy="no-referrer"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write"
        allowFullScreen
        onLoad={() => {
          setLoadedSrc(src);
          setFailedSrc(null);
        }}
        onError={() => setFailedSrc(src)}
        className="h-full w-full border-0 bg-black"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/90 via-black/45 to-transparent pt-safe">
        <div className="flex items-start justify-between gap-3 px-4 pb-8 pt-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">{title}</p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
              VixSrc · Italian audio
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
