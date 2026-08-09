"use client";

import {
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { formatPlayerClock } from "@/lib/player-progress";
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
};

/**
 * Custom native-player transport: center play/±10 + bottom scrubber/volume/FS.
 * Replaces browser <video controls> so lock mode cannot leak native chrome.
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
}: PlayerTransportProps) {
  const safeDur = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const ratio = safeDur > 0 ? Math.min(1, Math.max(0, currentTime / safeDur)) : 0;
  const remaining = safeDur > 0 ? Math.max(0, safeDur - currentTime) : 0;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-20 flex flex-col justify-between",
        className
      )}
    >
      {/* Center transport */}
      <div className="flex flex-1 items-center justify-center gap-8 px-4">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSeekBy(-10);
          }}
          aria-label="Seek back 10 seconds"
          className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-black/75"
        >
          <span className="relative flex items-center justify-center">
            <RotateCcw className="h-6 w-6" />
            <span className="absolute text-[9px] font-bold">10</span>
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
            <Play className="h-7 w-7 fill-white" />
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
          <span className="relative flex items-center justify-center">
            <RotateCcw className="h-6 w-6 scale-x-[-1]" />
            <span className="absolute text-[9px] font-bold">10</span>
          </span>
        </button>
      </div>

      {/* Bottom scrubber + volume / FS */}
      <div className="pointer-events-none bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-4 pt-10">
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
          <div className="flex items-center gap-3">
            <span className="min-w-[3.25rem] text-xs font-semibold tabular-nums text-white/90">
              {formatPlayerClock(currentTime)}
            </span>
            <span className="text-xs font-semibold tabular-nums text-white/45">
              -{formatPlayerClock(remaining)}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
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
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={muted ? 0 : Math.round(volume * 100)}
                aria-label="Volume"
                onChange={(e) => onVolume(Number(e.target.value) / 100)}
                onClick={(e) => e.stopPropagation()}
                className="hidden h-1 w-20 cursor-pointer appearance-none rounded-full bg-white/25 accent-primary sm:block [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
              />
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
