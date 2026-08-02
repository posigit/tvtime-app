"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode, useEffect } from "react";
import { ToastProvider } from "@/components/toast";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Avoid SW hijacking HMR / dev navigations
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    let reg: ServiceWorkerRegistration | null = null;

    const onVisible = () => {
      if (document.visibilityState === "visible" && reg) {
        reg.update().catch(() => {});
      }
    };

    navigator.serviceWorker
      .register("/sw.js", {
        // Always revalidate sw.js (server also sends no-cache headers)
        updateViaCache: "none",
      })
      .then((registration) => {
        if (cancelled) return;
        reg = registration;
        document.addEventListener("visibilitychange", onVisible);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
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
