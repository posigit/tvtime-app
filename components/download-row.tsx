"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Download, Pause, Play, Trash2 } from "lucide-react";
import { useToast } from "@/components/toast";
import {
  formatBytes,
  type DownloadRecord,
} from "@/lib/downloads";
import {
  deleteDownload,
  pauseDownload,
  resumeDownload,
} from "@/lib/downloader";

export function requestOfflinePlay(key: string) {
  window.dispatchEvent(
    new CustomEvent("tvtime:play-offline", { detail: { key } })
  );
}

/**
 * Global completion toast. The engine broadcasts tvtime:download-done;
 * this shows "Downloaded — View" which jumps to the library. Mount once
 * inside the toast provider.
 */
export function DownloadDoneNotifier() {
  const { toast } = useToast();
  const router = useRouter();
  useEffect(() => {
    const onDone = (e: Event) => {
      const d = (e as CustomEvent<{ key?: string; title?: string }>).detail;
      toast(`Downloaded${d?.title ? ` ${d.title}` : ""}`, "success", {
        label: "View",
        onClick: () => router.push("/downloads"),
      });
    };
    window.addEventListener("tvtime:download-done", onDone);
    return () => window.removeEventListener("tvtime:download-done", onDone);
  }, [toast, router]);
  return null;
}

/** True while the browser reports a connection (resume/retry need one). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function qualityLabel(r: DownloadRecord): string {
  const q = r.quality === "best" ? "Best" : `${r.quality}p`;
  return r.usedSource ? `${q} · ${r.usedSource}` : q;
}

/**
 * One download row: progress, play/pause/resume/delete. Shared by the
 * Download settings sheet and the /downloads library page. Resume/retry
 * refuse while offline (fetching is impossible); play/delete stay live.
 */
export function DownloadRow({
  record: r,
  onPlay,
}: {
  record: DownloadRecord;
  onPlay: () => void;
}) {
  const { toast } = useToast();
  const online = useOnline();
  const busy = r.state === "active" || r.state === "queued";
  const progress = r.totalSegments > 0 ? r.doneSegments / r.totalSegments : 0;

  const tryResume = () => {
    if (!online) {
      toast("You're offline — reconnect to download", "error");
      return;
    }
    const req =
      r.type === "movie"
        ? {
            type: "movie" as const,
            tmdbId: r.tmdbId,
            title: r.title,
            subtitle: r.subtitle,
          }
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
  };

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-3.5 py-3 ring-1 ring-white/[0.08]">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-white">{r.title}</p>
        {r.subtitle && (
          <p className="truncate text-xs text-white/45">{r.subtitle}</p>
        )}
        <p className="mt-1 text-[11px] font-semibold text-white/40">
          {r.state === "done" && r.sizeBytes > 0
            ? `${formatBytes(r.sizeBytes)} · ${qualityLabel(r)}`
            : busy
              ? `${Math.round(progress * 100)}%${r.estimateBytes > 0 ? ` of ~${formatBytes(r.estimateBytes)}` : ""}`
              : r.state === "paused"
                ? `Paused · ${Math.round(progress * 100)}%`
                : r.state === "error"
                  ? (r.error ?? "Failed")
                  : r.state === "missing"
                    ? "Removed from storage — download again"
                    : "Waiting…"}
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
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-primary text-black transition active:scale-95"
          >
            <Play className="h-4 w-4 fill-current" />
          </button>
        )}
        {(r.state === "paused" ||
          r.state === "error" ||
          r.state === "missing") && (
          <button
            type="button"
            onClick={tryResume}
            aria-label="Resume download"
            title={!online ? "Needs connection" : undefined}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/[0.08] text-white ring-1 ring-white/15 transition hover:bg-white/15 active:scale-95 disabled:opacity-40"
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
            onClick={() => void pauseDownload(r.key)}
            aria-label="Pause download"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/[0.08] text-white ring-1 ring-white/15 transition hover:bg-white/15 active:scale-95"
          >
            <Pause className="h-4 w-4" />
          </button>
        )}
        {/* Delete is always available — mid-download too. deleteDownload
            aborts an in-flight fetch before removing bytes + record. */}
        <button
          type="button"
          onClick={() => {
            void deleteDownload(r.key).catch((e: unknown) =>
              toast(e instanceof Error ? e.message : "Couldn't delete", "error")
            );
          }}
          aria-label={`Delete ${r.title}`}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/[0.08] text-white/60 ring-1 ring-white/15 transition hover:bg-white/15 hover:text-white active:scale-95"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        {r.state === "done" && (
          <span className="flex h-6 w-6 items-center justify-center">
            <Check className="h-4 w-4 text-success" strokeWidth={3} />
          </span>
        )}
      </div>
    </div>
  );
}
