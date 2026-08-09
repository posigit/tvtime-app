/**
 * Picture-in-Picture helpers.
 *
 * Desktop Chrome/Firefox: standard Picture-in-Picture API.
 * Safari (macOS + iOS): often needs WebKit presentation mode
 *   video.webkitSetPresentationMode('picture-in-picture').
 *
 * Limits:
 * - Requires a user gesture.
 * - iOS Home Screen / standalone PWA: PiP is typically unavailable
 *   (webkitSupportsPresentationMode('picture-in-picture') === false).
 *   Open in Safari browser for PiP on iPhone.
 */

type WebkitVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitPresentationMode?: string;
};

export function supportsPictureInPicture(
  video?: HTMLVideoElement | null
): boolean {
  if (typeof document === "undefined") return false;

  // Standard API
  if (
    document.pictureInPictureEnabled &&
    typeof HTMLVideoElement !== "undefined" &&
    "requestPictureInPicture" in HTMLVideoElement.prototype
  ) {
    // Standalone PWA on iOS often reports enabled but fails — prefer WebKit probe when video exists.
    if (video) {
      const w = video as WebkitVideo;
      if (typeof w.webkitSupportsPresentationMode === "function") {
        return w.webkitSupportsPresentationMode("picture-in-picture");
      }
    }
    return true;
  }

  // WebKit-only path (older Safari)
  if (video) {
    const w = video as WebkitVideo;
    return (
      typeof w.webkitSupportsPresentationMode === "function" &&
      w.webkitSupportsPresentationMode("picture-in-picture")
    );
  }

  // No video yet — optimistic for non-standalone Safari-like UAs
  if (typeof navigator !== "undefined") {
    const standalone =
      // iOS Safari "Add to Home Screen"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).standalone === true ||
      (typeof window !== "undefined" &&
        window.matchMedia?.("(display-mode: standalone)").matches);
    if (standalone) return false;
  }
  return true;
}

export function isInPictureInPicture(video?: HTMLVideoElement | null): boolean {
  if (typeof document !== "undefined" && document.pictureInPictureElement) {
    return true;
  }
  if (video) {
    const w = video as WebkitVideo;
    return w.webkitPresentationMode === "picture-in-picture";
  }
  return false;
}

/** Toggle PiP. Must be called from a user gesture. */
export async function togglePictureInPicture(
  video: HTMLVideoElement
): Promise<"entered" | "exited" | "unsupported" | "failed"> {
  const w = video as WebkitVideo;

  // Exit if already in PiP (either API)
  if (document.pictureInPictureElement === video) {
    try {
      await document.exitPictureInPicture();
      return "exited";
    } catch {
      return "failed";
    }
  }
  if (w.webkitPresentationMode === "picture-in-picture") {
    try {
      w.webkitSetPresentationMode?.("inline");
      return "exited";
    } catch {
      return "failed";
    }
  }

  // Safari / iOS: try WebKit first — more reliable than the standard API there.
  if (
    typeof w.webkitSupportsPresentationMode === "function" &&
    w.webkitSupportsPresentationMode("picture-in-picture") &&
    typeof w.webkitSetPresentationMode === "function"
  ) {
    try {
      w.webkitSetPresentationMode("picture-in-picture");
      return "entered";
    } catch {
      /* fall through to standard */
    }
  }

  // Standard API (Chrome, Edge, Firefox, some Safari builds)
  if (
    document.pictureInPictureEnabled &&
    typeof video.requestPictureInPicture === "function"
  ) {
    try {
      await video.requestPictureInPicture();
      return "entered";
    } catch {
      return "failed";
    }
  }

  return "unsupported";
}
