"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode, useEffect } from "react";
import { ToastProvider } from "@/components/toast";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Avoid SW hijacking HMR / dev navigations
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js", {
        // Always revalidate sw.js (server also sends no-cache headers)
        updateViaCache: "none",
      })
      .then((reg) => {
        // Check for updates when the app becomes visible again
        const onVisible = () => {
          if (document.visibilityState === "visible") {
            reg.update().catch(() => {});
          }
        };
        document.addEventListener("visibilitychange", onVisible);
        // One-shot cleanup if the effect re-runs (Strict Mode)
        return () => document.removeEventListener("visibilitychange", onVisible);
      })
      .catch(() => {});
  }, []);

  return (
    <SessionProvider
      // Avoid spamming GET /api/auth/session on every focus/nav
      refetchOnWindowFocus={false}
      refetchWhenOffline={false}
      refetchInterval={0}
    >
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  );
}
