"use client";

import { useEffect, useState } from "react";
import { ArrowDownToLine } from "lucide-react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * PWA install row. Rendered only when the browser fires beforeinstallprompt
 * (Chromium/Android); iOS has no prompt event, installed apps never fire
 * it — so nothing renders there instead of a dead button.
 */
export function InstallButton() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setDone(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // No prompt event (iOS Safari, already installed, desktop unsupported) —
  // render nothing instead of a dead button.
  if (!deferred || done) return null;
  return (
    <button
      type="button"
      onClick={() => {
        void deferred
          .prompt()
          .catch(() => {})
          .finally(() => setDeferred(null));
      }}
      className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-secondary"
    >
      <ArrowDownToLine className="h-4 w-4" />
      Install app
    </button>
  );
}
