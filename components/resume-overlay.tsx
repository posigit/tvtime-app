"use client";

import { useEffect, useRef, useState } from "react";

const AUTO_RESUME_SECS = 5;

function fmt(seconds: number): string {
  const total = Number.isFinite(seconds)
    ? Math.max(0, Math.floor(seconds))
    : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * "Resume from MM:SS?" overlay. Auto-resumes after 5s of inactivity
 * (binge-friendly); Restart clears the saved position and starts over.
 */
export function ResumeOverlay({
  positionSeconds,
  onResume,
  onRestart,
}: {
  positionSeconds: number;
  onResume: () => void;
  onRestart: () => void;
}) {
  const [remaining, setRemaining] = useState(AUTO_RESUME_SECS);
  const decidedRef = useRef(false);
  const onResumeRef = useRef(onResume);
  const onRestartRef = useRef(onRestart);

  useEffect(() => {
    onResumeRef.current = onResume;
    onRestartRef.current = onRestart;
  }, [onResume, onRestart]);

  const choose = (fn: () => void) => {
    if (decidedRef.current) return;
    decidedRef.current = true;
    fn();
  };

  useEffect(() => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (decidedRef.current) {
        clearInterval(tick);
        return;
      }
      const left = Math.max(
        0,
        AUTO_RESUME_SECS - Math.floor((Date.now() - started) / 1000)
      );
      setRemaining(left);
      if (left <= 0) {
        clearInterval(tick);
        choose(() => onResumeRef.current());
      }
    }, 250);
    return () => clearInterval(tick);
  }, []);

  return (
    <div className="absolute inset-0 z-[7] flex items-center justify-center bg-black/70">
      <div className="flex flex-col items-center gap-4 p-6 text-center">
        <p className="text-sm font-bold text-white">
          Resume from {fmt(positionSeconds)}?
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => choose(() => onResumeRef.current())}
            className="rounded-full bg-primary px-5 py-2 text-sm font-black text-black transition hover:bg-primary/90"
          >
            Resume
          </button>
          <button
            type="button"
            onClick={() => choose(() => onRestartRef.current())}
            className="rounded-full bg-white/10 px-5 py-2 text-sm font-bold text-white ring-1 ring-white/20 transition hover:bg-white/20"
          >
            Restart
          </button>
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
          Auto-resuming in {remaining}s
        </p>
      </div>
    </div>
  );
}
