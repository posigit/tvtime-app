"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";

const DISMISS_KEY = "tvtime-onboarding-dismissed";

/**
 * One-line first-run nudge for thin libraries (1–2 follows): import your
 * history or keep browsing so Tonight/Up Next have something to work with.
 * Dismiss persists locally; never renders for established libraries.
 */
export function OnboardingNudge() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return true;
    }
  });
  if (dismissed) return null;
  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };
  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-border bg-secondary px-4 py-3 shadow-lg shadow-black/30 backdrop-blur-xl">
      <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-foreground/85">
        New here?{" "}
        <Link href="/import" className="font-bold text-primary hover:underline">
          Import your data
        </Link>{" "}
        or keep following shows to fill your week.
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground/60 transition hover:bg-secondary hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
