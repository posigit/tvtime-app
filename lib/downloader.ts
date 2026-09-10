/**
 * Offline download engine (page context).
 *
 * Flow per item: resolve native playlist (vix/goated cascade — iframe
 * sources can never download, the browser never touches their bytes) →
 * pick variant at/below the quality setting → fetch segments + init + keys
 * through the same same-origin paths the player uses → store bytes in the
 * `tvtime-downloads` cache under `/api/dl?u=` keys → store the rewritten
 * playlist under `/api/dl?playlist=` → auto-fetch the subtitle track →
 * mark done. Pause/resume/cancel via per-key AbortControllers; resume
 * skips bytes already in the cache.
 */

import { resolveStreamPlaylist } from "@/lib/player-stream";
import { fetchExternalVtt } from "@/lib/player-subs";
import { loadVixSettings } from "@/lib/vix-settings";
import {
  DL_CACHE,
  canonicalMediaKey,
  commitRecord,
  deleteRecordFiles,
  dlFileUrl,
  dlPlaylistUrl,
  downloadKey,
  ensurePersisted,
  estimateBytes,
  formatBytes,
  getAllSync,
  getManifest,
  getRecordSync,
  isMasterPlaylist,
  parseMasterVariants,
  parseMediaPlaylist,
  pickVariant,
  removeRecord,
  rewritePlaylistForOffline,
  storageStats,
  updateProgress,
  upsertRecord,
  usedBytes,
  type DownloadRecord,
} from "@/lib/downloads";

export type DownloadRequest = {
  type: "movie" | "tv";
  tmdbId: number;
  season?: number;
  episode?: number;
  title: string;
  subtitle?: string;
};

const CONCURRENCY = 4;

const activeControllers = new Map<string, AbortController>();
const pauseIntents = new Set<string>();
const cancelIntents = new Set<string>();

export function isDownloadActive(key: string): boolean {
  return activeControllers.has(key);
}

function abortError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

export async function startDownload(req: DownloadRequest): Promise<void> {
  const settings = loadVixSettings();
  if (!settings.downloadMode) {
    throw new Error("Download mode is off — enable it in Download settings.");
  }
  const key = downloadKey(
    req.type === "movie" ? "movie" : "episode",
    req.tmdbId,
    req.season,
    req.episode
  );
  const existing = getRecordSync(key) ?? (await getManifest())[key];
  if (existing && (existing.state === "active" || existing.state === "queued")) {
    return; // already running
  }
  if (activeControllers.has(key)) return;

  const now = Date.now();
  const rec: DownloadRecord = {
    key,
    type: req.type === "movie" ? "movie" : "episode",
    tmdbId: req.tmdbId,
    season: req.season,
    episode: req.episode,
    title: req.title,
    subtitle: req.subtitle,
    quality: settings.downloadQuality,
    usedSource: existing?.usedSource ?? "",
    durationSec: existing?.durationSec ?? 0,
    estimateBytes: existing?.estimateBytes ?? 0,
    sizeBytes: 0,
    bytesDone: 0,
    totalSegments: existing?.totalSegments ?? 0,
    doneSegments: 0,
    fileUrls: [],
    state: "queued",
    error: undefined,
    subVtt: existing?.subVtt ?? null,
    subLabel: existing?.subLabel ?? null,
    downloadedAt: 0,
    lastUsedAt: now,
  };
  await upsertRecord(rec);

  const controller = new AbortController();
  activeControllers.set(key, controller);
  try {
    await runDownload(req, rec, controller.signal);
  } catch (err) {
    const cancelled = controller.signal.aborted;
    if (cancelIntents.has(key)) {
      cancelIntents.delete(key);
      pauseIntents.delete(key);
      await deleteRecordFiles(rec);
      await removeRecord(key);
      return;
    }
    if (cancelled && pauseIntents.has(key)) {
      pauseIntents.delete(key);
      await commitRecord({ ...rec, state: "paused", error: undefined });
      return;
    }
    await commitRecord({
      ...rec,
      state: "error",
      error: err instanceof Error ? err.message : "Download failed",
    });
  } finally {
    activeControllers.delete(key);
  }
}

export function pauseDownload(key: string) {
  if (!activeControllers.has(key)) return;
  pauseIntents.add(key);
  activeControllers.get(key)?.abort();
}

export async function resumeDownload(req: DownloadRequest): Promise<void> {
  const key = downloadKey(
    req.type === "movie" ? "movie" : "episode",
    req.tmdbId,
    req.season,
    req.episode
  );
  const rec = getRecordSync(key);
  if (rec && rec.state !== "done") {
    await upsertRecord({ ...rec, state: "queued", error: undefined });
  }
  return startDownload(req);
}

export function cancelDownload(key: string) {
  if (!activeControllers.has(key)) {
    // Not running — just drop the row + files.
    void (async () => {
      const rec = getRecordSync(key);
      if (rec) await deleteRecordFiles(rec);
      await removeRecord(key);
    })();
    return;
  }
  cancelIntents.add(key);
  pauseIntents.delete(key);
  activeControllers.get(key)?.abort();
}

export async function deleteDownload(key: string): Promise<void> {
  cancelIntents.delete(key);
  pauseIntents.delete(key);
  activeControllers.get(key)?.abort();
  activeControllers.delete(key);
  const rec = getRecordSync(key);
  if (rec) await deleteRecordFiles(rec);
  await removeRecord(key);
}

async function runDownload(
  req: DownloadRequest,
  rec: DownloadRecord,
  signal: AbortSignal
): Promise<void> {
  const throwIfAborted = () => {
    if (signal.aborted) throw abortError();
  };

  rec.state = "active";
  await upsertRecord(rec);

  // 1. Resolve a native playlist (vix/goated cascade covers vix fallback).
  const preferred = loadVixSettings().preferredSource;
  const source = preferred === "vix" || preferred === "goated" ? preferred : "goated";
  const resolved = await resolveStreamPlaylist({
    source,
    type: req.type,
    tmdbId: req.tmdbId,
    season: req.season,
    episode: req.episode,
    signal,
  });
  throwIfAborted();
  if (!resolved.playlistUrl) {
    throw new Error(
      "No downloadable stream — try again, or switch server and retry."
    );
  }
  rec.usedSource = resolved.usedSource ?? source;
  await upsertRecord(rec);

  // 2. Master → variant at/below the quality setting.
  const masterRes = await fetch(resolved.playlistUrl, { signal });
  if (!masterRes.ok) throw new Error(`Stream lookup failed (${masterRes.status})`);
  const masterText = await masterRes.text();
  throwIfAborted();

  let mediaUrl = resolved.playlistUrl;
  let mediaText = masterText;
  let bandwidth = 0;
  if (isMasterPlaylist(masterText)) {
    const variants = parseMasterVariants(masterText, resolved.playlistUrl);
    const picked = pickVariant(variants, rec.quality);
    if (!picked) throw new Error("No playable quality found for this title.");
    const vRes = await fetch(picked.url, { signal });
    if (!vRes.ok) throw new Error(`Quality fetch failed (${vRes.status})`);
    mediaText = await vRes.text();
    mediaUrl = picked.url;
    bandwidth = picked.bandwidth;
    throwIfAborted();
  }

  // 3. Segments + keys. Sample-AES can't be cached — refuse up front.
  const parts = parseMediaPlaylist(mediaText, mediaUrl);
  if (parts.sampleAes) {
    throw new Error("This source is encrypted and can't be saved offline.");
  }
  if (parts.segments.length === 0) {
    throw new Error("No video segments found in this stream.");
  }
  rec.durationSec = parts.durationSec;
  rec.totalSegments = parts.segments.length;
  rec.estimateBytes = estimateBytes(bandwidth, parts.durationSec);
  await upsertRecord(rec);

  // 4. Quota: device headroom + the 950MB-style self cap (LRU-evict to fit).
  await enforceQuota(rec);

  // 5. Fetch everything into the cache (resume skips what's already there).
  const cache = await caches.open(DL_CACHE);
  const jobs: { original: string; dlUrl: string; kind: "seg" | "key" }[] = [];
  if (parts.mapUrl) {
    jobs.push({
      original: parts.mapUrl,
      dlUrl: dlFileUrl(canonicalMediaKey(parts.mapUrl)),
      kind: "key",
    });
  }
  for (const k of parts.keys) {
    jobs.push({
      original: k.url,
      dlUrl: dlFileUrl(canonicalMediaKey(k.url)),
      kind: "key",
    });
  }
  for (const s of parts.segments) {
    jobs.push({
      original: s,
      dlUrl: dlFileUrl(canonicalMediaKey(s)),
      kind: "seg",
    });
  }

  let cursor = 0;
  let doneSeg = 0;
  let measuredBytes = 0;
  const fileUrls = new Set<string>();

  const readSize = (r: Response | undefined): number => {
    const n = Number(r?.headers.get("Content-Length") ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const worker = async () => {
    for (;;) {
      throwIfAborted();
      const i = cursor++;
      if (i >= jobs.length) return;
      const job = jobs[i]!;
      const hit = await cache.match(job.dlUrl);
      if (hit) {
        fileUrls.add(job.dlUrl);
        if (job.kind === "seg") {
          doneSeg++;
          measuredBytes += readSize(hit);
          rec.bytesDone = measuredBytes;
          rec.doneSegments = doneSeg;
          await updateProgress(rec.key, {
            bytesDone: rec.bytesDone,
            doneSegments: doneSeg,
          });
        }
        continue;
      }
      const res = await fetch(job.original, { signal });
      if (!res.ok) throw new Error(`Piece ${i + 1}/${jobs.length} failed.`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0) throw new Error(`Piece ${i + 1} was empty.`);
      const stored = new Response(buf, {
        headers: {
          "Content-Type":
            res.headers.get("content-type") ?? "application/octet-stream",
          "Content-Length": String(buf.byteLength),
          "Cache-Control": "public, max-age=31536000",
        },
      });
      try {
        await cache.put(job.dlUrl, stored);
      } catch (e) {
        if (
          e instanceof DOMException &&
          (e.name === "QuotaExceededError" || e.code === 22)
        ) {
          throw new Error("Out of device space — free storage and retry.");
        }
        throw e;
      }
      fileUrls.add(job.dlUrl);
      if (job.kind === "seg") {
        doneSeg++;
        measuredBytes += buf.byteLength;
        rec.bytesDone = measuredBytes;
        rec.doneSegments = doneSeg;
        await updateProgress(rec.key, {
          bytesDone: rec.bytesDone,
          doneSegments: doneSeg,
        });
      }
      throwIfAborted();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker())
  );

  // 6. Store the rewritten playlist last — only complete sets ever play.
  const offlineText = rewritePlaylistForOffline(mediaText, mediaUrl);
  const playlistKey = dlPlaylistUrl(rec.key);
  await cache.put(
    playlistKey,
    new Response(offlineText, {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-store",
      },
    })
  );
  fileUrls.add(playlistKey);
  rec.fileUrls = [...fileUrls];

  // 7. Auto-subtitles: same cascade the player uses (VDRK → OpenSubs).
  try {
    const sub = await fetchDownloadSubs(req, resolved.imdbId);
    if (sub) {
      rec.subVtt = sub.vtt;
      rec.subLabel = sub.label;
    }
  } catch {
    /* subs are a bonus — never fail the download for them */
  }

  rec.sizeBytes = measuredBytes;
  rec.state = "done";
  rec.error = undefined;
  rec.downloadedAt = Date.now();
  rec.lastUsedAt = Date.now();
  await commitRecord(rec);
}

async function fetchDownloadSubs(
  req: DownloadRequest,
  imdbId: string | null
): Promise<{ vtt: string; label: string } | null> {
  const settings = loadVixSettings();
  const subSource = settings.subSource;
  if (subSource === "off" || subSource === "stream") return null;
  if (subSource === "vdrk" || subSource === "auto") {
    const vdrk = await fetchExternalVtt({
      source: "vdrk",
      type: req.type,
      tmdbId: req.tmdbId,
      season: req.season,
      episode: req.episode,
    });
    if (vdrk?.vtt) return { vtt: vdrk.vtt, label: vdrk.label };
    if (subSource === "vdrk") return null;
  }
  if (!imdbId) return null;
  const os = await fetchExternalVtt({
    source: "opensub",
    imdbId,
    season: req.season,
    episode: req.episode,
  });
  if (os?.vtt) return { vtt: os.vtt, label: os.label };
  return null;
}

async function enforceQuota(rec: DownloadRecord): Promise<void> {
  const settings = loadVixSettings();
  const capBytes = settings.downloadCapMb * 1024 * 1024;
  const all = getAllSync();
  const need = rec.estimateBytes;

  // LRU: evict oldest finished downloads until the estimate fits the cap.
  if (need > 0) {
    let used = usedBytes(all);
    const victims = all
      .filter((r) => r.state === "done" && r.key !== rec.key)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    for (const v of victims) {
      if (used + need <= capBytes) break;
      await deleteRecordFiles(v);
      await removeRecord(v.key);
      used -= v.sizeBytes;
    }
    if (used + need > capBytes) {
      throw new Error(
        `Needs ~${formatBytes(need)} — free space or raise the cap in Download settings.`
      );
    }
  }

  // Device headroom (best-effort — the OS has the final word).
  try {
    const stats = await storageStats();
    if (
      need > 0 &&
      stats.quota != null &&
      stats.usage != null &&
      stats.usage + need > stats.quota
    ) {
      throw new Error("Not enough device storage for this download.");
    }
    await ensurePersisted().catch(() => false);
  } catch (e) {
    if (e instanceof Error && /device storage/.test(e.message)) throw e;
  }
}
