/**
 * Ordered playback position API queue.
 * Survives remounts so close+'reopen cannot race a prior keepalive write.
 *
 * Offline durability lives in lib/offline/store.ts (outbox); this module
 * keeps the live ordered queue plus the player-facing seam.
 */

import {
  enqueuePlayback,
  isPermanentFailure,
} from "@/lib/offline/store";

let playbackRequestQueue: Promise<void> = Promise.resolve();

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
