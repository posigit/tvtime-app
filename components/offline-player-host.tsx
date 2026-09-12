"use client";

import { useCallback, useEffect, useState } from "react";
import { VixPlayer } from "@/components/vix-player";
import {
  dlPlaylistUrl,
  getManifest,
  touchRecord,
  verifyRecordFiles,
} from "@/lib/downloads";
import { useToast } from "@/components/toast";

/**
 * Global offline-playback host. Anything (settings sheet, download rows)
 * can request offline play via `requestOfflinePlay(recordKey)`; the host
 * mounts a VixPlayer wired straight at the cached playlist + stored subs,
 * skipping stream resolution entirely.
 */
export function OfflinePlayerHost() {
  const { toast } = useToast();
  const [req, setReq] = useState<{
    key: string;
    nonce: number;
  } | null>(null);
  const [sub, setSub] = useState<{ vtt: string; label: string } | null>(null);
  const [meta, setMeta] = useState<{
    title: string;
    type: "movie" | "tv";
    tmdbId: number;
    season?: number;
    episode?: number;
  } | null>(null);

  useEffect(() => {
    const onPlay = (e: Event) => {
      const key = (e as CustomEvent<{ key: string }>).detail?.key;
      if (!key) return;
      // /api/dl is served ONLY by the service worker (no app route exists).
      // Without a controlling SW the player would spin on 404s — say so.
      if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
        toast("Offline player isn't ready — reload once online, then retry", "error");
        return;
      }
      void (async () => {
        const rec = (await getManifest())[key];
        if (!rec) {
          toast("Download not found", "error");
          return;
        }
        if (rec.state !== "done") {
          toast("That download isn't finished yet", "error");
          return;
        }
        const ok = await verifyRecordFiles(key);
        if (!ok) {
          toast("Files were cleared — download it again", "error");
          return;
        }
        await touchRecord(key);
        setSub(
          rec.subVtt ? { vtt: rec.subVtt, label: rec.subLabel ?? "Subtitles" } : null
        );
        setMeta({
          title: rec.title,
          type: rec.type === "movie" ? "movie" : "tv",
          tmdbId: rec.tmdbId,
          season: rec.season,
          episode: rec.episode,
        });
        setReq({ key, nonce: Date.now() });
      })();
    };
    window.addEventListener("tvtime:play-offline", onPlay);
    return () => window.removeEventListener("tvtime:play-offline", onPlay);
  }, [toast]);

  const close = useCallback(() => {
    setReq(null);
    setMeta(null);
    setSub(null);
  }, []);

  if (!req || !meta) return null;

  return (
    <VixPlayer
      key={`offline-${req.key}-${req.nonce}`}
      src={dlPlaylistUrl(req.key)}
      title={meta.title}
      type={meta.type}
      tmdbId={meta.tmdbId}
      season={meta.season}
      episode={meta.episode}
      autoResume={false}
      initialPlaylistUrl={dlPlaylistUrl(req.key)}
      initialSubVtt={sub}
      onEvent={() => {}}
      onClose={close}
    />
  );
}
