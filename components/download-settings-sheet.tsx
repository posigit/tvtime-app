"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Download, Pause, Play, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/toast";
import {
  DEFAULT_VIX_SETTINGS,
  loadVixSettings,
  saveVixSettings,
} from "@/lib/vix-settings";
import {
  deleteRecordFiles,
  ensurePersisted,
  formatBytes,
  getAllSync,
  getManifest,
  removeRecord,
  storageStats,
  subscribeDownloads,
  touchRecord,
  verifyRecordFiles,
  type DownloadRecord,
} from "@/lib/downloads";
import { cancelDownload, resumeDownload } from "@/lib/downloader";

const QUALITY_OPTIONS = [
  { value: 480, label: "480p", hint: "Smallest · fits several episodes" },
  { value: 720, label: "720p", hint: "Recommended · ~1 episode per GB" },
  { value: 1080, label: "1080p", hint: "Big files · desktop territory" },
  { value: "best", label: "Best", hint: "Top quality the source offers" },
] as const;

export function requestOfflinePlay(key: string) {
  window.dispatchEvent(new CustomEvent("tvtime:play-offline", { detail: { key } }));
}

/**
 * Download settings bottom sheet: mode toggle, quality select, storage
 * meter, and the downloads library (play offline / delete).
 */
export function DownloadSettingsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState(false);
  const [quality, setQuality] = useState<480 | 720 | 1080 | "best">(720);
  const [items, setItems] = useState<DownloadRecord[]>([]);
  const [quota, setQuota] = useState<number | undefined>();
  const [usage, setUsage] = useState<number | undefined>();
  const capMb = DEFAULT_VIX_SETTINGS.downloadCapMb;

  const readSettings = useCallback(() => {
    try {
      const s = loadVixSettings();
      return { mode: s.downloadMode === true, quality: s.downloadQuality };
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    // All state writes happen in async continuations (never sync in the
    // effect body) so open-time hydration doesn't cascade-render.
    void (async () => {
      const s = readSettings();
      if (!alive) return;
      if (s) {
        setMode(s.mode);
        setQuality(s.quality);
      }
      setItems(getAllSync());
      const st = await storageStats();
      if (!alive) return;
      setQuota(st.quota);
      setUsage(st.usage);
      // Flip stale `done` rows to `missing` when the OS evicted bytes.
      const m = await getManifest();
      if (!alive) return;
      await Promise.all(
        Object.values(m)
          .filter((r) => r.state === "done")
          .map((r) => verifyRecordFiles(r.key))
      );
      if (!alive) return;
      setItems(getAllSync());
    })();
    const unsub = subscribeDownloads(() => {
      setItems(getAllSync());
      void storageStats().then((st) => {
        setQuota(st.quota);
        setUsage(st.usage);
      });
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      unsub();
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, readSettings]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open ]);

  if (!open) return null;

  const toggleMode = () => {
    const next = !mode;
    setMode(next);
    saveVixSettings({ downloadMode: next });
    if (next) void ensurePersisted();
    toast(next ? "Download mode on" : "Download mode off");
  };

  const pickQuality = (q: 480 | 720 | 1080 | "best") => {
    setQuality(q);
    saveVixSettings({ downloadQuality: q });
  };

  const usedByApp = items
    .filter((r) => r.state === "done")
    .reduce((s, r) => s + r.sizeBytes, 0);
  const capBytes = capMb * 1024 * 1024;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col">
      <button
        type="button"
        aria-label="Close download settings"
        className="absolute inset-0 bg-black/75 backdrop-blur-[3px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Download settings"
        className="relative mt-auto flex max-h-[93dvh] w-full flex-col rounded-t-[1.35rem] bg-[#0a0a0c] shadow-[0_-20px_60px_rgba(0,0,0,0.65)] ring-1 ring-white/[0.08]"
      >
        <div className="flex justify-center pb-1 pt-2.5">
          <div className="h-1 w-10 rounded-full bg-white/15" />
        </div>
        <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-1">
          <div>
            <h2 className="text-xl font-black tracking-tight text-white">
              Downloads
            </h2>
            <p className="text-xs text-white/40">
              Watch offline · kept on this device only
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-safe-page">
          {/* Mode toggle */}
          <button
            type="button"
            onClick={toggleMode}
            aria-pressed={mode}
            className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white/[0.04] px-4 py-3.5 ring-1 ring-white/[0.08] transition active:scale-[0.99]"
          >
            <span className="text-left">
              <span className="block text-sm font-bold text-white">
                Download mode
              </span>
              <span className="mt-0.5 block text-xs text-white/45">
                {mode ? "Download buttons are visible" : "Off — no download buttons"}
              </span>
            </span>
            <span
              aria-hidden
              className={cn(
                "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                mode ? "bg-success" : "bg-white/15"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all",
                  mode ? "left-[1.375rem]" : "left-0.5"
                )}
              />
            </span>
          </button>

          {/* Quality */}
          <p className="mb-2 mt-5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">
            Download quality
          </p>
          <div className="grid grid-cols-4 gap-2">
            {QUALITY_OPTIONS.map((q) => (
              <button
                key={String(q.value)}
                type="button"
                onClick={() => pickQuality(q.value)}
                title={q.hint}
                className={cn(
                  "rounded-2xl px-2 py-2.5 text-sm font-black ring-1 transition active:scale-95",
                  quality === q.value
                    ? "bg-primary text-black ring-primary"
                    : "bg-white/[0.05] text-white/60 ring-white/10 hover:text-white"
                )}
              >
                {q.label}
              </button>
            ))}
          </div>

          {/* Storage meter */}
          <div className="mt-5 rounded-2xl bg-white/[0.04] px-4 py-3.5 ring-1 ring-white/[0.08]">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-bold text-white">Storage</p>
              <p className="text-xs font-semibold text-white/45">
                {formatBytes(usedByApp)} of {formatBytes(capBytes)}
              </p>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${Math.min(100, (usedByApp / capBytes) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/35">
              Cap {capMb} MB · 950&nbsp;MB ≈ one 720p episode. Oldest downloads
              make room automatically.
              {usage != null && quota != null && (
                <> Device free ≈ {formatBytes(quota - usage)}.</>
              )}
            </p>
          </div>

          {/* Library */}
          <p className="mb-2 mt-5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">
            On this device ({items.length})
          </p>
          {items.length === 0 ? (
            <p className="rounded-2xl bg-white/[0.03] px-4 py-6 text-center text-sm text-white/35 ring-1 ring-white/[0.06]">
              Nothing here yet. Turn on download mode and tap ↓ on a movie or
              episode.
            </p>
          ) : (
            <div className="space-y-2 pb-4">
              {items.map((r) => (
                <DownloadRow key={r.key} record={r} onPlay={() => {
                  onClose();
                  void touchRecord(r.key);
                  requestOfflinePlay(r.key);
                }} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DownloadRow({
  record: r,
  onPlay,
}: {
  record: DownloadRecord;
  onPlay: () => void;
}) {
  const { toast } = useToast();
  const busy = r.state === "active" || r.state === "queued";
  const progress =
    r.totalSegments > 0 ? r.doneSegments / r.totalSegments : 0;

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-3.5 py-3 ring-1 ring-white/[0.08]">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-white">{r.title}</p>
        {r.subtitle && (
          <p className="truncate text-xs text-white/45">{r.subtitle}</p>
        )}
        <p className="mt-1 text-[11px] font-semibold text-white/40">
          {r.state === "done" && r.sizeBytes > 0
            ? formatBytes(r.sizeBytes)
            : busy
              ? `${Math.round(progress * 100)}%${r.estimateBytes > 0 ? ` · ~${formatBytes(r.estimateBytes)}` : ""}`
              : r.state === "paused"
                ? `Paused · ${Math.round(progress * 100)}%`
                : r.state === "error"
                  ? (r.error ?? "Failed")
                  : r.state === "missing"
                    ? "Removed from storage"
                    : "Waiting…"}
          {r.usedSource ? ` · ${r.usedSource}` : ""}
        </p>
        {busy && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {r.state === "done" && (
          <button
            type="button"
            onClick={onPlay}
            aria-label={`Play ${r.title} offline`}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-black transition active:scale-95"
          >
            <Play className="h-4 w-4 fill-current" />
          </button>
        )}
        {(r.state === "paused" || r.state === "error" || r.state === "missing") && (
          <button
            type="button"
            onClick={() => {
              const req =
                r.type === "movie"
                  ? { type: "movie" as const, tmdbId: r.tmdbId, title: r.title, subtitle: r.subtitle }
                  : {
                      type: "tv" as const,
                      tmdbId: r.tmdbId,
                      season: r.season,
                      episode: r.episode,
                      title: r.title,
                      subtitle: r.subtitle,
                    };
              void resumeDownload(req).catch((e: unknown) =>
                toast(e instanceof Error ? e.message : "Couldn't resume", "error")
              );
            }}
            aria-label="Resume download"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] text-white ring-1 ring-white/15 transition hover:bg-white/15 active:scale-95"
          >
            {r.state === "paused" ? (
              <Play className="h-4 w-4 fill-current" />
            ) : (
              <Download className="h-4 w-4" />
            )}
          </button>
        )}
        {busy && (
          <button
            type="button"
            onClick={() => cancelDownload(r.key)}
            aria-label="Cancel download"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] text-white ring-1 ring-white/15 transition hover:bg-white/15 active:scale-95"
          >
            <Pause className="h-4 w-4" />
          </button>
        )}
        {(r.state === "done" || r.state === "error" || r.state === "missing") && (
          <button
            type="button"
            onClick={() => {
              void (async () => {
                const rec = (await getManifest())[r.key];
                if (rec) await deleteRecordFiles(rec);
                await removeRecord(r.key);
              })();
            }}
            aria-label={`Delete ${r.title}`}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] text-white/60 ring-1 ring-white/15 transition hover:bg-white/15 hover:text-white active:scale-95"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        {r.state === "done" && (
          <span className="flex h-6 w-6 items-center justify-center">
            <Check className="h-4 w-4 text-success" strokeWidth={3} />
          </span>
        )}
      </div>
    </div>
  );
}
