"use client";

import type { MutableRefObject, RefObject } from "react";
import {
  Captions,
  Check,
  Gauge,
  Lock,
  PictureInPicture2,
  Volume2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { VixSettings } from "@/lib/vix-settings";
import type { SubSource } from "@/lib/player-subs";
import type {
  AudioTrackInfo,
  PlayerMode,
  QualityLevelInfo,
  StreamSource,
} from "@/lib/player-native-types";

type PlayerTopChromeProps = {
  title: string;
  mode: PlayerMode;
  activeSource: StreamSource;
  streamable: boolean;
  isLoading: boolean;
  playbackSpeed: number;
  onCycleSpeed: () => void;
  audioTracks: AudioTrackInfo[];
  audioTrackId: number;
  audioMenuOpen: boolean;
  setAudioMenuOpen: (open: boolean | ((v: boolean) => boolean)) => void;
  qualityLevels: QualityLevelInfo[];
  qualitySelection: "auto" | number;
  qualityMenuOpen: boolean;
  setQualityMenuOpen: (open: boolean | ((v: boolean) => boolean)) => void;
  subSource: SubSource;
  subMenuOpen: boolean;
  setSubMenuOpen: (open: boolean | ((v: boolean) => boolean)) => void;
  onSubSource: (next: SubSource) => void;
  hasExternalSubs: boolean;
  subDelay: number;
  onAdjustSubDelay: (delta: number) => void;
  subFontSize: VixSettings["subFontSize"];
  subColor: VixSettings["subColor"];
  subBgOpacity: number;
  onPatchSubStyle: (
    patch: Partial<
      Pick<VixSettings, "subFontSize" | "subColor" | "subBgOpacity">
    >
  ) => void;
  subError: string | null;
  onSwitchSource: () => void;
  onPictureInPicture: () => void;
  onLock: () => void;
  onClose: () => void;
  onKeepChrome: () => void;
  subMenuRef: RefObject<HTMLDivElement | null>;
  audioMenuRef: RefObject<HTMLDivElement | null>;
  qualityMenuRef: RefObject<HTMLDivElement | null>;
  setHlsAudioTrackRef: MutableRefObject<((id: number) => void) | null>;
  setHlsQualityRef: MutableRefObject<((next: "auto" | number) => void) | null>;
};

/**
 * Top bar: title, speed/audio/quality/CC Look, source switch, PiP, lock, close.
 * Transport (play/scrub) lives in PlayerTransport.
 */
export function PlayerTopChrome({
  title,
  mode,
  activeSource,
  streamable,
  isLoading,
  playbackSpeed,
  onCycleSpeed,
  audioTracks,
  audioTrackId,
  audioMenuOpen,
  setAudioMenuOpen,
  qualityLevels,
  qualitySelection,
  qualityMenuOpen,
  setQualityMenuOpen,
  subSource,
  subMenuOpen,
  setSubMenuOpen,
  onSubSource,
  hasExternalSubs,
  subDelay,
  onAdjustSubDelay,
  subFontSize,
  subColor,
  subBgOpacity,
  onPatchSubStyle,
  subError,
  onSwitchSource,
  onPictureInPicture,
  onLock,
  onClose,
  onKeepChrome,
  subMenuRef,
  audioMenuRef,
  qualityMenuRef,
  setHlsAudioTrackRef,
  setHlsQualityRef,
}: PlayerTopChromeProps) {
  return (
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
              onClick={onCycleSpeed}
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
                  onKeepChrome();
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
                  onKeepChrome();
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
                  onKeepChrome();
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
                      onClick={() => onSubSource(key)}
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
                              onAdjustSubDelay(-0.5);
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
                              onAdjustSubDelay(0.5);
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
                              onPatchSubStyle({ subFontSize: key });
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
                              onPatchSubStyle({ subColor: key });
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
                                onPatchSubStyle({ subBgOpacity: value });
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
              onClick={onSwitchSource}
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
                onClick={onPictureInPicture}
                aria-label="Picture in picture"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80"
              >
                <PictureInPicture2 className="h-4 w-4" />
              </button>
            )}
          <button
            type="button"
            onClick={onLock}
            aria-label="Lock player controls"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80"
          >
            <Lock className="h-5 w-5" />
          </button>
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
  );
}
