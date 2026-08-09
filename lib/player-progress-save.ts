/**
 * Client-side progress save controller: throttle, 92% clear, ordered API queue.
 */

import { MAX_PLAYBACK_SECONDS } from "@/lib/player-constants";
import {
  isFinishedPosition,
  shouldSaveProgress,
} from "@/lib/player-progress";
import {
  queuePlaybackRequest,
  waitForPlaybackRequests,
} from "@/lib/player-playback-api";

export type ProgressSaveRefs = {
  saveEnabledRef: { current: boolean };
  endedRef: { current: boolean };
  bookmarkClearedRef: { current: boolean };
  lastSavedPosRef: { current: number };
  lastSavedAtRef: { current: number };
};

export function createSavePosition(
  getParams: () => string | null,
  refs: ProgressSaveRefs
) {
  return (pos: number, duration: number, force = false) => {
    if (!refs.saveEnabledRef.current || refs.endedRef.current) return;
    const params = getParams();
    if (!params) return;
    if (!Number.isFinite(pos) || pos <= 0) return;
    const position = Math.min(MAX_PLAYBACK_SECONDS, pos);
    if (!Number.isFinite(position) || position <= 0) return;
    const dur =
      Number.isFinite(duration) && duration > 0
        ? Math.min(MAX_PLAYBACK_SECONDS, duration)
        : 0;
    if (isFinishedPosition(position, dur)) {
      if (!refs.bookmarkClearedRef.current) {
        refs.bookmarkClearedRef.current = true;
        refs.lastSavedPosRef.current = 0;
        queuePlaybackRequest(params, {
          method: "DELETE",
          keepalive: true,
        });
      }
      return;
    }
    refs.bookmarkClearedRef.current = false;
    const now = Date.now();
    if (
      !shouldSaveProgress({
        pos: position,
        force,
        lastSavedPos: refs.lastSavedPosRef.current,
        lastSavedAt: refs.lastSavedAtRef.current,
        now,
      })
    ) {
      return;
    }
    refs.lastSavedPosRef.current = position;
    refs.lastSavedAtRef.current = now;
    queuePlaybackRequest(params, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        positionSeconds: position,
        durationSeconds: dur,
      }),
      keepalive: true,
    });
  };
}

export function createClearPosition(getParams: () => string | null, refs: ProgressSaveRefs) {
  return () => {
    const params = getParams();
    if (!params) return;
    refs.bookmarkClearedRef.current = true;
    queuePlaybackRequest(params, {
      method: "DELETE",
      keepalive: true,
    });
  };
}

export { waitForPlaybackRequests, queuePlaybackRequest };
