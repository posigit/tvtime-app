"use client";

import { useEffect } from "react";

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
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
  useEffect(() => {
    const t = setTimeout(onResume, 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            onClick={onResume}
            className="rounded-full bg-primary px-5 py-2 text-sm font-black text-black transition hover:bg-primary/90"
          >
            Resume
          </button>
          <button
            type="button"
            onClick={onRestart}
            className="rounded-full bg-white/10 px-5 py-2 text-sm font-bold text-white ring-1 ring-white/20 transition hover:bg-white/20"
          >
            Restart
          </button>
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
          Auto-resuming in 5s
        </p>
      </div>
    </div>
  );
}
