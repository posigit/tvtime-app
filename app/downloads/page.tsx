"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import {
  DownloadRow,
  requestOfflinePlay,
  useOnline,
} from "@/components/download-row";
import {
  formatBytes,
  getAllSync,
  getManifest,
  subscribeDownloads,
  touchRecord,
  type DownloadRecord,
} from "@/lib/downloads";

/**
 * Downloads library: fully local (IndexedDB manifest + Cache Storage
 * bytes), zero server data — so the service worker can serve this shell
 * with no connection and everything still works. Play/delete are local;
 * resume/retry refuse while offline (rows handle that themselves).
 */
export default function DownloadsPage() {
  const online = useOnline();
  const [items, setItems] = useState<DownloadRecord[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void getManifest().then(() => {
      if (alive) {
        setItems(getAllSync());
        setReady(true);
      }
    });
    const unsub = subscribeDownloads(() => {
      if (alive) setItems(getAllSync());
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  const doneCount = items.filter((r) => r.state === "done").length;
  const usedByApp = items
    .filter((r) => r.state === "done")
    .reduce((s, r) => s + r.sizeBytes, 0);

  return (
    <div className="mx-auto min-h-dvh w-full max-w-2xl px-4 pb-28 pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="flex items-center gap-3">
        <Link
          href="/profile"
          aria-label="Back to profile"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-white ring-1 ring-white/10 transition hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-black text-white">Downloads</h1>
          <p className="text-xs text-white/45">
            {doneCount} saved
            {usedByApp > 0 ? ` · ${formatBytes(usedByApp)} on this device` : ""}
          </p>
        </div>
      </div>

      {!online && (
        <p className="mt-3 rounded-2xl bg-primary/10 px-4 py-2.5 text-xs font-bold text-primary ring-1 ring-primary/30">
          You&apos;re offline — saved videos still play. New downloads need a
          connection.
        </p>
      )}

      <div className="mt-4 space-y-2">
        {!ready ? (
          <p className="py-10 text-center text-sm text-white/40">Loading…</p>
        ) : items.length === 0 ? (
          <div className="rounded-2xl bg-white/[0.03] px-4 py-10 text-center ring-1 ring-white/[0.06]">
            <Download className="mx-auto h-5 w-5 text-white/30" />
            <p className="mt-2 text-sm font-semibold text-white/50">
              Nothing here yet
            </p>
            <p className="mt-0.5 text-xs text-white/30">
              Turn on download mode and tap + on a movie or episode
            </p>
          </div>
        ) : (
          items.map((r) => (
            <DownloadRow
              key={r.key}
              record={r}
              onPlay={() => {
                void touchRecord(r.key);
                requestOfflinePlay(r.key);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
