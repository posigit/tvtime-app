"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Renders active TextTrack cues in a div we fully control.
 * Native ::cue styling is unreliable with <video controls> / hls.js —
 * this is the only dependable way to do color / size / background.
 */
export function SubtitleOverlay({
  videoRef,
  enabled,
  fontScale,
  color,
  bgOpacity,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  /** 1 = 100%, up to 1.25 = +25%. */
  fontScale: number;
  color: string;
  bgOpacity: number;
}) {
  const [text, setText] = useState("");

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !enabled) {
      setText("");
      return;
    }

    const readCues = () => {
      const lines: string[] = [];
      const tracks = video.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        if (track.kind !== "subtitles" && track.kind !== "captions") continue;
        // "hidden" still exposes activeCues; "showing" would double-draw.
        if (track.mode === "disabled") continue;
        const cues = track.activeCues;
        if (!cues) continue;
        for (let j = 0; j < cues.length; j++) {
          const raw = (cues[j] as VTTCue).text || "";
          const plain = raw
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .trim();
          if (plain) lines.push(plain);
        }
      }
      setText(lines.join("\n"));
    };

    const bind = () => {
      const tracks = video.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        tracks[i].addEventListener("cuechange", readCues);
      }
      readCues();
    };

    bind();
    // Tracks appear asynchronously (hls / inject).
    const onAdd = () => bind();
    video.textTracks.addEventListener("addtrack", onAdd);
    const poll = window.setInterval(readCues, 500);

    return () => {
      window.clearInterval(poll);
      video.textTracks.removeEventListener("addtrack", onAdd);
      const tracks = video.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        tracks[i].removeEventListener("cuechange", readCues);
      }
    };
  }, [videoRef, enabled]);

  if (!enabled || !text) return null;

  const fontPx = Math.round(18 * fontScale);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[12%] z-[15] flex justify-center px-4">
      <p
        className="max-w-[90%] whitespace-pre-wrap text-center font-semibold leading-snug shadow-black/80"
        style={{
          fontSize: fontPx,
          color,
          backgroundColor:
            bgOpacity > 0 ? `rgba(0, 0, 0, ${bgOpacity})` : "transparent",
          padding: bgOpacity > 0 ? "0.2em 0.55em" : 0,
          borderRadius: 6,
          textShadow:
            bgOpacity > 0
              ? "none"
              : "0 1px 2px #000, 0 0 6px #000, 0 0 2px #000",
        }}
      >
        {text}
      </p>
    </div>
  );
}
