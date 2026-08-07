"use client";

import { SessionProvider, useSession } from "next-auth/react";
import { ReactNode, useEffect } from "react";
import { ToastProvider } from "@/components/toast";
import { hydrateVixSettings } from "@/lib/vix-settings";

/** Hydrates player settings once the session is known (per-user data). */
function SettingsHydrator() {
  const { status } = useSession();
  useEffect(() => {
    if (status === "authenticated") void hydrateVixSettings();
  }, [status]);
  return null;
}

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
      <SettingsHydrator />
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  );
}
