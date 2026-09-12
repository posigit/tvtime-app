/**
 * Ordered playback position API queue.
 * Survives remounts so close+'reopen cannot race a prior keepalive write.
 *
 * Offline outbox: failed saves (network throw, 5xx/429, or 401/403 while
 * logged out) persist to IndexedDB, coalesced per episode (last-write-wins;
 * a DELETE absorbs pending POSTs), and replay when connectivity returns.
 * 400/404/422 are dropped immediately (replay can't heal them).
 */

import { get, set } from "idb-keyval";

let playbackRequestQueue: Promise<void> = Promise.resolve();

export type OutboxEntry = {
  /** Playback key, e.g. "tv:123:1:2" (the /api/playback query). */
  params: string;
  method: string;
  body?: string;
  at: number;
  attempts: number;
};

const OUTBOX_IDB_KEY = "tvtime-playback-outbox-v1";
/** Cap the outbox (episodes are tiny; this is many movies of backlog). */
const OUTBOX_MAX = 200;
/** Give up replaying a single entry after this many failed drains. */
const OUTBOX_MAX_ATTEMPTS = 20;

async function loadOutbox(): Promise<OutboxEntry[]> {
  try {
    const raw = await get<OutboxEntry[]>(OUTBOX_IDB_KEY);
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function saveOutbox(list: OutboxEntry[]): Promise<void> {
  try {
    await set(OUTBOX_IDB_KEY, list.slice(-OUTBOX_MAX));
  } catch {
    /* storage unavailable — sync just won't survive reload */
  }
}

/**
 * Pure coalesce: same params+method replaces (positions), a DELETE absorbs
 * pending POSTs for the same key (finished beats everything before it).
 * Exported for unit tests.
 */
export function coalesceOutbox(
  list: OutboxEntry[],
  entry: OutboxEntry
): OutboxEntry[] {
  const next = list.filter(
    (e) =>
      !(
        e.params === entry.params &&
        (e.method === entry.method ||
          (entry.method === "DELETE" && e.method !== "DELETE"))
      )
  );
  next.push(entry);
  return next.slice(-OUTBOX_MAX);
}

async function enqueuePlayback(entry: Omit<OutboxEntry, "at" | "attempts">): Promise<void> {
  const list = await loadOutbox();
  await saveOutbox(
    coalesceOutbox(list, { ...entry, at: Date.now(), attempts: 0 })
  );
}

/** Non-replayable statuses: replaying can never heal these. */
function isPermanentFailure(status: number): boolean {
  return status === 400 || status === 404 || status === 422;
}

let draining = false;

/**
 * Replay queued saves oldest-first. Independent episodes don't block each
 * other: failures stay queued (attempts++) for the next drain; successes
 * and over-retried/permanent entries leave. Safe to call any time.
 */
export async function drainPlaybackOutbox(): Promise<void> {
  if (draining || typeof window === "undefined") return;
  draining = true;
  try {
    const list = await loadOutbox();
    if (list.length === 0) return;
    for (const entry of list) {
      try {
        const res = await fetch(`/api/playback?${entry.params}`, {
          method: entry.method,
          headers: { "Content-Type": "application/json" },
          body: entry.body,
          credentials: "same-origin",
        });
        if (res.ok || isPermanentFailure(res.status)) {
          entry.attempts = OUTBOX_MAX_ATTEMPTS + 1; // mark for removal
        } else {
          entry.attempts += 1;
        }
      } catch {
        entry.attempts += 1;
      }
    }
    await saveOutbox(list.filter((e) => e.attempts < OUTBOX_MAX_ATTEMPTS));
  } finally {
    draining = false;
  }
}

let outboxInit = false;

/**
 * Wire reconnect/startup drains. Idempotent — call once from Providers.
 * No Background Sync dependency: the online event + app start cover every
 * browser (SyncManager is Chromium-only).
 */
export function initPlaybackOutbox(): void {
  if (outboxInit || typeof window === "undefined") return;
  outboxInit = true;
  void drainPlaybackOutbox();
  window.addEventListener("online", () => {
    void drainPlaybackOutbox();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void drainPlaybackOutbox();
  });
}

export function queuePlaybackRequest(params: string, init: RequestInit) {
  const method = init.method || "GET";
  const body = typeof init.body === "string" ? init.body : undefined;
  const request = playbackRequestQueue
    .catch(() => {})
    .then(() =>
      fetch(`/api/playback?${params}`, {
        ...init,
        credentials: "same-origin",
      })
    )
    .then(
      (res) => {
        if (res.ok) return undefined;
        if (isPermanentFailure(res.status)) {
          console.warn("[playback] save rejected", params, res.status);
          return undefined;
        }
        // Transient (5xx/429/401/403): outbox for replay on reconnect.
        void enqueuePlayback({ params, method, body });
        return undefined;
      },
      (err) => {
        // Network failure (offline): outbox for replay on reconnect.
        console.warn(
          "[playback] save request failed — queued for sync",
          params,
          err instanceof Error ? err.message : err
        );
        void enqueuePlayback({ params, method, body });
        return undefined;
      }
    );
  playbackRequestQueue = request;
}

export function waitForPlaybackRequests() {
  return playbackRequestQueue.catch(() => {});
}
