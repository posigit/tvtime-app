/**
 * Reliable seek for HLS: currentTime often fails or snaps back until
 * fragments are available. Retry with backoff until it sticks.
 */

export function seekVideoElement(
  video: HTMLVideoElement,
  targetSeconds: number,
  opts?: { play?: boolean; maxAttempts?: number }
): void {
  if (!Number.isFinite(targetSeconds) || targetSeconds < 0) return;
  const play = opts?.play !== false;
  const maxAttempts = opts?.maxAttempts ?? 24;
  let attempts = 0;

  const trySeek = () => {
    if (attempts++ >= maxAttempts) {
      if (play) void video.play().catch(() => {});
      return;
    }
    if (video.readyState < 1) {
      window.setTimeout(trySeek, 200);
      return;
    }
    const duration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : null;
    const target =
      duration == null ? targetSeconds : Math.min(targetSeconds, duration);
    try {
      video.currentTime = target;
    } catch {
      window.setTimeout(trySeek, 200);
      return;
    }
    // HLS often reports 0 until the first fragment seeks — re-check.
    window.setTimeout(() => {
      if (
        !Number.isFinite(video.currentTime) ||
        Math.abs(video.currentTime - target) > 1.5
      ) {
        trySeek();
        return;
      }
      if (play) void video.play().catch(() => {});
    }, 120);
  };

  trySeek();
}

/**
 * iOS Safari (and some WebViews) ignore HTMLMediaElement.volume —
 * only muted works. Detect once per page.
 */
export function canControlVolume(video?: HTMLVideoElement | null): boolean {
  if (typeof window === "undefined") return true;
  // iPhone/iPad/iPod: volume is always 1 and setting it is a no-op.
  const ua = window.navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return false;
  // iPadOS 13+ desktop UA still lacks volume control on media elements.
  if (
    navigator.platform === "MacIntel" &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1
  ) {
    return false;
  }
  if (!video) return true;
  try {
    const prev = video.volume;
    const probe = prev === 0.5 ? 0.51 : 0.5;
    video.volume = probe;
    const ok = Math.abs(video.volume - probe) < 0.02;
    video.volume = prev;
    return ok;
  } catch {
    return false;
  }
}
