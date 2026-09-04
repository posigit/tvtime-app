"use client";

import type { MutableRefObject, RefObject } from "react";
import {
  Captions,
  Check,
  Crop,
  Gauge,
  Lock,
  SkipForward,
  Smartphone,
  Volume2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { sourceLabel } from "@/lib/embed-sources";
import type { VixSettings } from "@/lib/vix-settings";
import type { OpenSubListItem, SubSource } from "@/lib/player-subs";
import type {
  AudioTrackInfo,
  PlayerMode,
  QualityLevelInfo,
  StreamSource,
} from "@/lib/player-native-types";
import { useEffect, useRef, useState } from "react";

type PlayerTopChromeProps = {
  title: string;
  mode: PlayerMode;
  activeSource: StreamSource;
  streamable: boolean;
  isLoading: boolean;
  playbackSpeed: number;
  onCycleSpeed: () => void;
  videoFit: VixSettings["videoFit"];
  embedZoom: VixSettings["embedZoom"];
  onCycleScreenFill: () => void;
  audioTracks: AudioTrackInfo[];
  audioTrackId: number;
  audioMenuOpen: boolean;
  setAudioMenuOpen: (open: boolean | ((v: boolean) => boolean)) => void;
  qualityLevels: QualityLevelInfo[];
  qualitySelection: "auto" | number;
  qualityMenuOpen: boolean;
  setQualityMenuOpen: (open: boolean | ((v: boolean) => boolean)) => void;
  /** Embed override (CineSrc): reloads the frame with a quality param. */
  onPickQuality?: (quality: "auto" | number) => void;
  subSource: SubSource;
  subMenuOpen: boolean;
  setSubMenuOpen: (open: boolean | ((v: boolean) => boolean)) => void;
  onSubSource: (next: SubSource) => void;
  /** Top OpenSubtitles files (max 3). */
  openSubItems: OpenSubListItem[];
  openSubFileId: number | null;
  openSubListLoading: boolean;
  onOpenSubPick: (item: OpenSubListItem) => void;
  hasExternalSubs: boolean;
  subDelay: number;
  onAdjustSubDelay: (delta: number) => void;
  subFontSize: VixSettings["subFontSize"];
  subColor: VixSettings["subColor"];
  subBgOpacity: number;
  subBgBlur: VixSettings["subBgBlur"];
  onPatchSubStyle: (
    patch: Partial<
      Pick<
        VixSettings,
        "subFontSize" | "subColor" | "subBgOpacity" | "subBgBlur"
      >
    >
  ) => void;
  subError: string | null;
  onSwitchSource: () => void;
  /** Pick a specific source from the menu (sourceOptions). */
  onPickSource: (source: StreamSource) => void;
  /** All selectable sources for the picker (labels + active marker). */
  sourceOptions: StreamSource[];
  /** Sources that must render disabled (e.g. degraded backends). */
  disabledSources?: StreamSource[];
  /** TV only — toggle 10…0 auto-advance after Up Next appears. */
  showAutoplayToggle?: boolean;
  autoplayNext?: boolean;
  onToggleAutoplayNext?: () => void;
  autoRotate?: boolean;
  onToggleAutoRotate?: () => void;
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
 * Top bar: title, speed/audio/quality/CC Look, source switch, lock, close.
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
  videoFit,
  embedZoom,
  onCycleScreenFill,
  audioTracks,
  audioTrackId,
  audioMenuOpen,
  setAudioMenuOpen,
  qualityLevels,
  qualitySelection,
  qualityMenuOpen,
  setQualityMenuOpen,
  onPickQuality,
  subSource,
  subMenuOpen,
  setSubMenuOpen,
  onSubSource,
  openSubItems,
  openSubFileId,
  openSubListLoading,
  onOpenSubPick,
  hasExternalSubs,
  subDelay,
  onAdjustSubDelay,
  subFontSize,
  subColor,
  subBgOpacity,
  subBgBlur,
  onPatchSubStyle,
  subError,
  onSwitchSource,
  onPickSource,
  sourceOptions,
  disabledSources = [],
  showAutoplayToggle = false,
  autoplayNext = true,
  onToggleAutoplayNext,
  autoRotate = true,
  onToggleAutoRotate,
  onLock,
  onClose,
  onKeepChrome,
  subMenuRef,
  audioMenuRef,
  qualityMenuRef,
  setHlsAudioTrackRef,
  setHlsQualityRef,
}: PlayerTopChromeProps) {
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const sourceMenuRef = useRef<HTMLDivElement>(null);
  // Outside-dismiss + Escape + scroll — mirrors the sub/audio/quality menus.
  useEffect(() => {
    if (!sourceMenuOpen) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const node = e.target as Node | null;
      if (sourceMenuRef.current && node && !sourceMenuRef.current.contains(node)) {
        setSourceMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setSourceMenuOpen(false);
      }
    };
    const onScroll = () => setSourceMenuOpen(false);
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
  }, [sourceMenuOpen]);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/90 via-black/50 to-transparent pt-[max(0.5rem,env(safe-area-inset-top))]">
      {/*
        Mobile: title on its own row, controls in a horizontal scroller so
        buttons never clamp over the title (portrait screenshot bug).
        Desktop: classic side-by-side.
      */}
      <div className="flex flex-col gap-2 px-3 pb-8 pt-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3 sm:px-4 sm:pt-3">
        <div className="min-w-0 sm:max-w-[40%]">
          <p className="truncate text-sm font-bold text-white">{title}</p>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
            {sourceLabel(activeSource)}
          </p>
        </div>
        <div className="pointer-events-auto flex max-w-full shrink-0 items-center gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:justify-end sm:gap-2 sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden">
          {(mode === "native" ||
            (mode === "iframe" && activeSource === "cinesrc")) && (
            <button
              type="button"
              onClick={onCycleSpeed}
              aria-label="Playback speed"
              className="flex h-9 items-center rounded-full bg-black/60 px-3 text-xs font-bold text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80"
            >
              {playbackSpeed}×
            </button>
          )}
          {(mode === "native" || mode === "iframe") && (
            <button
              type="button"
              onClick={onCycleScreenFill}
              aria-label="Screen fill mode"
              className="flex h-9 items-center gap-1.5 rounded-full bg-black/60 px-3 text-xs font-bold text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80"
            >
              <Crop className="h-4 w-4" />
              <span className="hidden sm:inline">
                {mode === "native"
                  ? videoFit === "fit"
                    ? "Fit"
                    : videoFit === "cover"
                      ? "Cover"
                      : "Stretch"
                  : `${Math.round(embedZoom * 100)}%`}
              </span>
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
          {((mode === "native" && qualityLevels.length > 0) ||
            (mode === "iframe" &&
              activeSource === "cinesrc" &&
              onPickQuality)) && (
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
                      if (onPickQuality) onPickQuality("auto");
                      else setHlsQualityRef.current?.("auto");
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
                        if (onPickQuality) onPickQuality(lv.height);
                        else setHlsQualityRef.current?.(lv.height);
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
          {(mode === "native" ||
            (mode === "iframe" &&
              (activeSource === "cinesrc" ||
                activeSource === "vidfast" ||
                activeSource === "mapple"))) && (
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
                  // overflow-y-auto + max height: was overflow-hidden which
                  // clipped Look (colors/bg) at the bottom of the panel.
                  className="absolute right-0 top-full z-40 mt-2 w-60 max-h-[min(70vh,28rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-card py-1 shadow-xl"
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                >
                  {(
                    (
                      mode === "iframe"
                        ? [
                            ["auto", "Auto"],
                            ["vdrk", "VDRK"],
                            ["opensub", "OpenSubs"],
                            ["off", "Off"],
                          ]
                        : [
                            ["auto", "Auto"],
                            ["stream", "Stream"],
                            ["vdrk", "VDRK"],
                            ["opensub", "OpenSubs"],
                            ["off", "Off"],
                          ]
                    ) as [SubSource, string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="menuitem"
                      onClick={() => onSubSource(key)}
                      className={cn(
                        "flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm font-semibold text-white hover:bg-secondary",
                        subSource === key &&
                          key !== "opensub" &&
                          "bg-secondary/60 text-primary",
                        subSource === "opensub" &&
                          key === "opensub" &&
                          "bg-secondary/60 text-primary"
                      )}
                    >
                      {label}
                      {subSource === key && (
                        <Check className="h-4 w-4 flex-shrink-0" />
                      )}
                    </button>
                  ))}

                  {/* Top 3 OpenSubtitles releases — pick the one that syncs. */}
                  {subSource === "opensub" && (
                    <div className="border-t border-white/10 py-1">
                      <p className="px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/45">
                        Top 3 files
                      </p>
                      {openSubListLoading && (
                        <p className="px-3.5 py-2 text-[11px] text-white/50">
                          Loading…
                        </p>
                      )}
                      {!openSubListLoading && openSubItems.length === 0 && (
                        <p className="px-3.5 py-2 text-[11px] text-white/50">
                          No English files found
                        </p>
                      )}
                      {openSubItems.map((item, i) => (
                        <button
                          key={item.fileId}
                          type="button"
                          role="menuitem"
                          onClick={() => onOpenSubPick(item)}
                          className={cn(
                            "flex w-full flex-col gap-0.5 px-3.5 py-2 text-left hover:bg-secondary",
                            openSubFileId === item.fileId &&
                              "bg-secondary/60 text-primary"
                          )}
                        >
                          <span className="flex items-center justify-between gap-2 text-xs font-semibold text-white">
                            <span className="truncate">
                              {i + 1}. {item.label}
                            </span>
                            {openSubFileId === item.fileId && (
                              <Check className="h-3.5 w-3.5 shrink-0" />
                            )}
                          </span>
                          <span className="text-[10px] font-medium text-white/40">
                            {item.format.toUpperCase()}
                            {item.downloads > 0
                              ? ` · ${item.downloads.toLocaleString()} dl`
                              : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

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
                    <div className="space-y-3 border-t border-white/10 px-3.5 py-3">
                      <div className="flex items-center gap-1.5">
                        {(
                          [
                            ["xs", "75%"],
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
                      {/* Stack color + bg on separate rows so nothing clips. */}
                      <div className="flex items-center gap-2">
                        <span className="w-8 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-white/45">
                          Color
                        </span>
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
                              "h-8 w-8 shrink-0 rounded-full ring-2",
                              subColor === key
                                ? "ring-primary"
                                : "ring-white/20"
                            )}
                            style={{ backgroundColor: hex }}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-8 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-white/45">
                          BG
                        </span>
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
                              "h-8 min-w-8 flex-1 rounded-lg px-1.5 text-[10px] font-bold",
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
                      <div className="flex items-center gap-2">
                        <span className="w-8 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-white/45">
                          Blur
                        </span>
                        {(
                          [
                            ["none", "0"],
                            ["sm", "S"],
                            ["md", "M"],
                            ["lg", "L"],
                          ] as [VixSettings["subBgBlur"], string][]
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onPatchSubStyle({ subBgBlur: value });
                            }}
                            className={cn(
                              "h-8 min-w-8 flex-1 rounded-lg px-1.5 text-[10px] font-bold",
                              subBgBlur === value
                                ? "bg-primary text-black"
                                : "bg-secondary text-white"
                            )}
                            aria-label={`Background blur ${label}`}
                          >
                            {label}
                          </button>
                        ))}
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
            <div ref={sourceMenuRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  onKeepChrome();
                  setSourceMenuOpen((v) => !v);
                }}
                aria-label={`Switch source (currently ${activeSource})`}
                aria-expanded={sourceMenuOpen}
                aria-haspopup="menu"
                className="flex h-9 items-center gap-1.5 rounded-full bg-black/60 px-3 text-xs font-bold text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80"
              >
                <span className="hidden sm:inline">Source</span>
                <span className="text-white/60">
                  {sourceLabel(activeSource)}
                </span>
              </button>
              {sourceMenuOpen && (
                <div
                  role="menu"
                  aria-label="Stream sources"
                  className="absolute right-0 top-full z-30 mt-2 max-h-[min(70vh,28rem)] w-48 max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-xl border border-white/15 bg-white/[0.06] shadow-2xl backdrop-blur-2xl"
                >
                  {sourceOptions.map((key) => {
                    const disabled = disabledSources.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        role="menuitem"
                        disabled={disabled}
                        onClick={() => {
                          setSourceMenuOpen(false);
                          onPickSource(key);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-white transition hover:bg-white/10",
                          activeSource === key && "text-primary",
                          disabled && "cursor-not-allowed opacity-40 hover:bg-transparent"
                        )}
                      >
                        {sourceLabel(key)}
                        {disabled && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-white/50">
                            Off
                          </span>
                        )}
                        {!disabled && activeSource === key && (
                          <Check className="h-4 w-4 flex-shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {showAutoplayToggle && onToggleAutoplayNext && (
            <button
              type="button"
              onClick={() => {
                onKeepChrome();
                onToggleAutoplayNext();
              }}
              aria-label={
                autoplayNext
                  ? "Autoplay next episode on"
                  : "Autoplay next episode off"
              }
              aria-pressed={autoplayNext}
              title={
                autoplayNext
                  ? "Autoplay next: on"
                  : "Autoplay next: off (Up Next still shows)"
              }
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold ring-1 backdrop-blur transition",
                autoplayNext
                  ? "bg-primary/20 text-primary ring-primary/40 hover:bg-primary/30"
                  : "bg-black/60 text-white/50 ring-white/20 hover:bg-black/80 hover:text-white/80"
              )}
            >
              <SkipForward className="h-4 w-4" />
              <span className="hidden sm:inline">
                {autoplayNext ? "Auto" : "Manual"}
              </span>
            </button>
          )}
          {onToggleAutoRotate && (
            <button
              type="button"
              onClick={() => {
                onKeepChrome();
                onToggleAutoRotate();
              }}
              aria-label={
                autoRotate ? "Auto-rotate on" : "Auto-rotate off"
              }
              aria-pressed={autoRotate}
              title={
                autoRotate
                  ? "Auto-rotate: fullscreen goes landscape"
                  : "Auto-rotate: off"
              }
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold ring-1 backdrop-blur transition",
                autoRotate
                  ? "bg-primary/20 text-primary ring-primary/40 hover:bg-primary/30"
                  : "bg-black/60 text-white/50 ring-white/20 hover:bg-black/80 hover:text-white/80"
              )}
            >
              <Smartphone className="h-4 w-4" />
              <span className="hidden sm:inline">
                {autoRotate ? "Auto" : "Fixed"}
              </span>
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
