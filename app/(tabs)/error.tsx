"use client";

import { useEffect } from "react";
import { BottomNav } from "@/components/bottom-nav";

/**
 * Tab-level crash boundary — keeps the bottom nav chrome (unlike the root
 * error page) so a tab crash never strands the user without navigation.
 */
export default function TabsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[tabs-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col pb-nav">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <p className="text-lg font-black text-foreground">Something broke</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          This tab ran into a problem. Your library and downloads are safe.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-2 rounded-full bg-primary px-6 py-3 text-sm font-black uppercase tracking-wide text-black transition active:scale-95"
        >
          Try again
        </button>
      </div>
      <BottomNav />
    </div>
  );
}
