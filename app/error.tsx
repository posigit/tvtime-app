"use client";

import { useEffect } from "react";

/**
 * Route-level crash boundary (Next.js app/error.tsx convention).
 * Dark, minimal, with a working Try again — replaces the blank crash page.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <p className="text-lg font-black text-foreground">Something broke</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        This screen ran into a problem. Your library and downloads are safe.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-2 rounded-full bg-primary px-6 py-3 text-sm font-black uppercase tracking-wide text-black transition active:scale-95"
      >
        Try again
      </button>
    </div>
  );
}
