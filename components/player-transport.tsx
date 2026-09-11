"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Server,
  Volume2,
  VolumeX,
} from "lucide-react";
import { formatPlayerClock } from "@/lib/player-progress";
import { canControlVolume } from "@/lib/player-seek";
import { cn } from "@/lib/utils";

type PlayerTransportProps = {
  currentTime: number;
  duration: number;
  paused: boolean;
  muted: boolean;
  volume: number;
  isFullscreen: boolean;
  /** Hide interactive chrome (parent already gates visibility). */
  className?: string;
  onTogglePlay: () => void;
  onSeekBy: (delta: number) => void;
  onSeekRatio: (ratio: number) => void;
  onToggleMute: () => void;
  onVolume: (volume: number) => void;
  onToggleFullscreen: () => void;
  /**
   * CineSrc sub-server picker (bottom bar, so the top chrome stays uncrowded).
   * Rendered only when provided (CineSrc driven embed).
   */
  serverOptions?: { id: string; name: string; sub?: string }[];
  activeServer?: string;
  onPickServer?: (id: string) => void;
};

/**
 * Custom native-player transport: center play/±10 + bottom scrubber/volume/FS.
 * Replaces browser <video controls> so lock mode cannot leak native chrome.
 *
 * Volume slider: hidden on iOS (Safari ignores HTMLMediaElement.volume — mute
 * only). Shown on desktop and Android where volume actually works.
 */
export function PlayerTransport({
  currentTime,
  duration,
  paused,
  muted,
  volume,
  isFullscreen,
  className,
  onTogglePlay,
  onSeekBy,
  onSeekRatio,
  onToggleMute,
  onVolume,
  onToggleFullscreen,
  serverOptions,
  activeServer = "auto",
  onPickServer,
}: PlayerTransportProps) {
  const safeDur = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const ratio = safeDur > 0 ? Math.min(1, Math.max(0, currentTime / safeDur)) : 0;
  const remaining = safeDur > 0 ? Math.max(0, safeDur - currentTime) : 0;
  // UA-based. iOS Safari ignores HTMLMediaElement.volume — mute only.
  // Lazy init: player only mounts client-side after open, so no SSR mismatch.
  const [volumeSupported] = useState(() => canControlVolume(null));
  const [serverMenuOpen, setServerMenuOpen] = useState(false);
  const serverMenuRef = useRef<HTMLDivElement>(null);
  const activeServerLabel =
    serverOptions?.find((s) => s.id === activeServer)?.name ?? "Auto";
  // Outside-dismiss + Escape for the sub-server menu (mirrors top chrome).
  useEffect(() => {
    if (!serverMenuOpen) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const node = e.target as Node | null;
      if (serverMenuRef.current && node && !serverMenuRef.current.contains(node)) {
        setServerMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setServerMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer, { passive: true });
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [serverMenuOpen]);

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-20",
        className
      )}
    >
      {/* True visual center of the frame (not flex leftover above scrubber). */}
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-6 sm:gap-8">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSeekBy(-10);
          }}
          aria-label="Seek back 10 seconds"
          className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-black/75"
        >
          <span className="relative flex h-6 w-6 items-center justify-center">
            <RotateCcw className="h-6 w-6" />
            <span className="absolute text-[9px] font-bold leading-none">10</span>
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePlay();
          }}
          aria-label={paused ? "Play" : "Pause"}
          className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80"
        >
          {paused ? (
            // Play glyph is optically left-heavy — nudge for true center.
            <Play className="h-7 w-7 translate-x-0.5 fill-white" />
          ) : (
            <Pause className="h-7 w-7 fill-white" />
          )}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSeekBy(10);
          }}
          aria-label="Seek forward 10 seconds"
          className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-black/75"
        >
          <span className="relative flex h-6 w-6 items-center justify-center">
            <RotateCcw className="h-6 w-6 scale-x-[-1]" />
            <span className="absolute text-[9px] font-bold leading-none">10</span>
          </span>
        </button>
      </div>

      {/* Bottom scrubber + volume / FS */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-10 sm:px-4 sm:pb-4">
        <div className="pointer-events-auto flex flex-col gap-2">
          <label className="sr-only" htmlFor="player-seek">
            Seek
          </label>
          <input
            id="player-seek"
            type="range"
            min={0}
            max={1000}
            step={1}
            value={Math.round(ratio * 1000)}
            onChange={(e) => onSeekRatio(Number(e.target.value) / 1000)}
            onClick={(e) => e.stopPropagation()}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/25 accent-primary [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
          />
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="min-w-[2.75rem] text-xs font-semibold tabular-nums text-white/90 sm:min-w-[3.25rem]">
              {formatPlayerClock(currentTime)}
            </span>
            <span className="text-xs font-semibold tabular-nums text-white/45">
              -{formatPlayerClock(remaining)}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              {serverOptions && onPickServer && (
                <div ref={serverMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setServerMenuOpen((v) => !v);
                    }}
                    aria-label={`Sub-server (currently ${activeServerLabel})`}
                    aria-expanded={serverMenuOpen}
                    aria-haspopup="menu"
                    title={`Server: ${activeServerLabel}`}
                    className="flex h-9 items-center gap-1.5 rounded-full bg-black/50 px-3 text-xs font-bold text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-black/70"
                  >
                    <Server className="h-4 w-4" />
                    <span className="hidden sm:inline">{activeServerLabel}</span>
                  </button>
                  {serverMenuOpen && (
                    <div
                      role="menu"
                      aria-label="Sub-servers"
                      className="absolute bottom-full right-0 z-30 mb-2 max-h-[40vh] w-44 overflow-y-auto overscroll-contain rounded-xl border border-white/15 bg-white/[0.06] py-1 shadow-2xl backdrop-blur-2xl [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.25)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20"
                    >
                      {serverOptions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          role="menuitem"
                          onClick={(e) => {
                            e.stopPropagation();
                            setServerMenuOpen(false);
                            onPickServer(s.id);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm font-medium text-white transition hover:bg-white/10",
                            activeServer === s.id && "text-primary"
                          )}
                        >
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate">{s.name}</span>
                            {s.sub && s.sub !== s.name && (
                              <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-white/40">
                                {s.sub}
                              </span>
                            )}
                          </span>
                          {activeServer === s.id && (
                            <Check className="h-4 w-4 flex-shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMute();
                }}
                aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-black/70"
              >
                {muted || volume === 0 ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </button>
              {volumeSupported && (
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={muted ? 0 : Math.round(volume * 100)}
                  aria-label="Volume"
                  onChange={(e) => onVolume(Number(e.target.value) / 100)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-white/25 accent-primary sm:w-20 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                />
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFullscreen();
                }}
                aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-black/70"
              >
                {isFullscreen ? (
                  <Minimize className="h-4 w-4" />
                ) : (
                  <Maximize className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
