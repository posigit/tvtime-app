/**
 * Ordered playback position API queue.
 * Survives remounts so close→reopen cannot race a prior keepalive write.
 */

let playbackRequestQueue: Promise<void> = Promise.resolve();

export function queuePlaybackRequest(params: string, init: RequestInit) {
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
        if (!res.ok) {
          console.warn("[playback] save rejected", params, res.status);
        }
        return undefined;
      },
      (err) => {
        console.warn(
          "[playback] save request failed",
          params,
          err instanceof Error ? err.message : err
        );
        return undefined;
      }
    );
  playbackRequestQueue = request;
}

export function waitForPlaybackRequests() {
  return playbackRequestQueue.catch(() => {});
}
