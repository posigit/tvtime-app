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
import { loadVixSettings, matchLang } from "@/lib/vix-settings";
import {
  DL_CACHE,
  buildOfflineMaster,
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
  parseMasterAudio,
  parseMasterVariants,
  parseMediaPlaylist,
  pickAudioEntry,
  pickVariant,
  removeRecord,
  rewritePlaylistForOffline,
  storageStats,
  updateProgress,
  upsertRecord,
  usedBytes,
  type AudioEntry,
  type DownloadRecord,
  type MediaParts,
  type VariantInfo,
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

/**
 * Turn a failed native resolution into an honest message. The generic
 * "no downloadable stream" hid the real cause: on Vercel-class hosting the
 * sources block direct requests, so without the standalone resolver
 * (VIX_RESOLVER_URL) there is no native path at all — while iframe
 * playback keeps working, which made the old message look like a lie.
 */
function diagnoseResolveFailure(r: {
  code?: string;
  detail?: string;
  attempts?: Array<{ source: string; ok: boolean; error?: string }>;
}): string {
  if (r.code === "resolver_unconfigured") {
    return "Downloads need the stream resolver — VIX_RESOLVER_URL isn't set on this deployment, and the sources block it directly. Streaming still works via embeds, but offline needs native. Set the env var and redeploy.";
  }
  if (r.code === "resolution_failed") {
    return `Stream resolver failed${r.detail ? ` (${r.detail})` : ""} Check the resolver service, then retry.`;
  }
  if (r.code === "upstream_unreachable") {
    return "Sources are unreachable from this deployment right now. Retry in a bit — embed streaming is unaffected.";
  }
  const tried = (r.attempts ?? [])
    .filter((a) => !a.ok)
    .map((a) => a.source)
    .join(", ");
  return `No downloadable stream${tried ? ` (tried: ${tried})` : ""} — the title may only exist on embed sources right now.`;
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
    throw new Error(diagnoseResolveFailure(resolved));
  }
  rec.usedSource = resolved.usedSource ?? source;
  await upsertRecord(rec);

  // 2. Master → variant at/below the quality setting. The resolver may
  // hand back a relative same-origin proxy path — absolutize once so every
  // URL resolution below (variants, segments, keys) actually works.
  const playlistBase = new URL(
    resolved.playlistUrl,
    window.location.origin
  ).toString();
  const masterRes = await fetch(playlistBase, { signal });
  if (!masterRes.ok) throw new Error(`Stream lookup failed (${masterRes.status})`);
  const masterText = await masterRes.text();
  throwIfAborted();

  let mediaUrl = playlistBase;
  let mediaText = masterText;
  let bandwidth = 0;
  let pickedVariant: VariantInfo | null = null;
  const isMaster = isMasterPlaylist(masterText);
  if (isMaster) {
    const variants = parseMasterVariants(masterText, playlistBase);
    pickedVariant = pickVariant(variants, rec.quality);
    if (!pickedVariant) throw new Error("No playable quality found for this title.");
    const vRes = await fetch(pickedVariant.url, { signal });
    if (!vRes.ok) throw new Error(`Quality fetch failed (${vRes.status})`);
    mediaText = await vRes.text();
    mediaUrl = pickedVariant.url;
    bandwidth = pickedVariant.bandwidth;
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

  // 3b. Separate audio rendition. Vix-style masters pair each video variant
  // with an EXT-X-MEDIA audio group — skip this and downloads play silent.
  let audioParts: MediaParts | null = null;
  let audioUrl: string | null = null;
  let audioText: string | null = null;
  let audioEntry: AudioEntry | null = null;
  if (isMaster && pickedVariant?.audioGroup) {
    const entries = parseMasterAudio(masterText, playlistBase).filter(
      (e) => e.groupId === (pickedVariant as VariantInfo).audioGroup
    );
    audioEntry = pickAudioEntry(
      entries,
      loadVixSettings().audio || "en",
      matchLang
    );
    if (audioEntry) {
      const aRes = await fetch(audioEntry.url, { signal });
      if (!aRes.ok) throw new Error(`Audio track fetch failed (${aRes.status})`);
      let aText = await aRes.text();
      audioUrl = audioEntry.url;
      if (isMasterPlaylist(aText)) {
        const aVars = parseMasterVariants(aText, audioEntry.url);
        if (aVars.length === 0) {
          throw new Error("No audio track found for this title.");
        }
        const aPicked = aVars[0]!;
        const avRes = await fetch(aPicked.url, { signal });
        if (!avRes.ok) throw new Error(`Audio track fetch failed (${avRes.status})`);
        aText = await avRes.text();
        audioUrl = aPicked.url;
      }
      const parsed = parseMediaPlaylist(aText, audioUrl);
      if (parsed.sampleAes) {
        throw new Error("This source is encrypted and can't be saved offline.");
      }
      if (parsed.segments.length === 0) {
        // Audio declared but empty — video-only rather than a failure.
        audioEntry = null;
        audioUrl = null;
      } else {
        audioParts = parsed;
        audioText = aText;
      }
      throwIfAborted();
    }
  }

  rec.durationSec = parts.durationSec;
  rec.totalSegments =
    parts.segments.length + (audioParts?.segments.length ?? 0);
  rec.estimateBytes = estimateBytes(bandwidth, parts.durationSec);
  await upsertRecord(rec);

  // 4. Quota: device headroom + the 950MB-style self cap (LRU-evict to fit).
  await enforceQuota(rec);

  // 5. Fetch everything into the cache (resume skips what's already there).
  const cache = await caches.open(DL_CACHE);
  const fileUrls = new Set<string>();
  let doneSeg = 0;
  let measuredBytes = 0;

  const readSize = (r: Response | undefined): number => {
    const n = Number(r?.headers.get("Content-Length") ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const mpegResponse = (text: string, noStore = false) =>
    new Response(text, {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": noStore ? "no-store" : "public, max-age=31536000",
      },
    });

  const reportProgress = async () => {
    rec.bytesDone = measuredBytes;
    rec.doneSegments = doneSeg;
    await updateProgress(rec.key, {
      bytesDone: rec.bytesDone,
      doneSegments: doneSeg,
    });
  };

  const storeParts = async (
    list: MediaParts,
    label: string
  ): Promise<void> => {
    const jobs: { original: string; dlUrl: string; kind: "seg" | "key" }[] = [];
    if (list.mapUrl) {
      jobs.push({
        original: list.mapUrl,
        dlUrl: dlFileUrl(canonicalMediaKey(list.mapUrl)),
        kind: "key",
      });
    }
    for (const k of list.keys) {
      jobs.push({
        original: k.url,
        dlUrl: dlFileUrl(canonicalMediaKey(k.url)),
        kind: "key",
      });
    }
    for (const s of list.segments) {
      jobs.push({
        original: s,
        dlUrl: dlFileUrl(canonicalMediaKey(s)),
        kind: "seg",
      });
    }
    let cursor = 0;
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
            await reportProgress();
          }
          continue;
        }
        const res = await fetch(job.original, { signal });
        if (!res.ok) throw new Error(`${label} piece failed.`);
        const buf = await res.arrayBuffer();
        if (buf.byteLength === 0) throw new Error(`${label} piece was empty.`);
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
          await reportProgress();
        }
        throwIfAborted();
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker())
    );
  };

  await storeParts(parts, "Video");
  throwIfAborted();
  if (audioParts) await storeParts(audioParts, "Audio");
  throwIfAborted();

  // 6. Store rewritten playlists last — only complete sets ever play.
  const videoStoredUrl = dlFileUrl(canonicalMediaKey(mediaUrl));
  await cache.put(
    videoStoredUrl,
    mpegResponse(rewritePlaylistForOffline(mediaText, mediaUrl))
  );
  fileUrls.add(videoStoredUrl);
  let topText: string;
  if (audioParts && audioUrl && audioText && audioEntry && pickedVariant) {
    const audioStoredUrl = dlFileUrl(canonicalMediaKey(audioUrl));
    await cache.put(
      audioStoredUrl,
      mpegResponse(rewritePlaylistForOffline(audioText, audioUrl))
    );
    fileUrls.add(audioStoredUrl);
    topText = buildOfflineMaster({
      variant: pickedVariant,
      videoPlaylistUrl: videoStoredUrl,
      audio: audioEntry,
      audioPlaylistUrl: audioStoredUrl,
    });
  } else {
    topText = rewritePlaylistForOffline(mediaText, mediaUrl);
  }
  const playlistKey = dlPlaylistUrl(rec.key);
  await cache.put(playlistKey, mpegResponse(topText, true));
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
