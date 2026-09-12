"use client";

import { useCallback, useEffect, useState } from "react";
import { VixPlayer } from "@/components/vix-player";
import {
  dlPlaylistUrl,
  getManifest,
  readOfflinePosition,
  touchRecord,
  verifyRecordFiles,
} from "@/lib/downloads";
import { isResumablePosition } from "@/lib/player-progress";
import type { IntroDbSegments } from "@/lib/introdb";
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
  /** Local stop position for auto-resume (jump straight, no prompt). */
  const [resumeAt, setResumeAt] = useState<number | null>(null);
  /** Segments captured with the download (offline skip/outro). */
  const [storedSegments, setStoredSegments] = useState<IntroDbSegments | null>(null);
  /** Stored spare subtitle files (best-first) for offline switching. */
  const [storedAlts, setStoredAlts] = useState<{ vtt: string; label: string }[] | null>(null);
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
        // Auto-resume from the local stop position when still mid-way.
        const stored = readOfflinePosition(key);
        setResumeAt(
          stored && isResumablePosition(stored.pos, stored.dur)
            ? stored.pos
            : null
        );
        setStoredSegments(rec.segments ?? null);
        setStoredAlts(rec.subAlts?.length ? rec.subAlts : null);
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
    setResumeAt(null);
    setStoredSegments(null);
    setStoredAlts(null);
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
      initialPosition={resumeAt}
      initialPlaylistUrl={dlPlaylistUrl(req.key)}
      offlineKey={req.key}
      initialSubVtt={sub}
      initialSubAlts={storedAlts}
      initialSegments={storedSegments}
      onEvent={() => {}}
      onClose={close}
    />
  );
}
