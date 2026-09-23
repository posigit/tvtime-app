"use client";

import { SessionProvider, useSession } from "next-auth/react";
import { ReactNode, useEffect } from "react";
import { ToastProvider } from "@/components/toast";
import { hydrateVixSettings } from "@/lib/vix-settings";
import { initPlaybackOutbox } from "@/lib/offline/store";

/** Hydrates player settings once the session is known (per-user data). */
function SettingsHydrator() {
  const { status } = useSession();
  useEffect(() => {
    if (status === "authenticated") void hydrateVixSettings();
  }, [status]);
  return null;
}

/** Re-asserts the saved appearance theme on mount + across tabs. */
function ThemeHydrator() {
  useEffect(() => {
    try {
      const t = localStorage.getItem("tv-theme");
      if (t === "light" || t === "soft" || t === "amoled") {
        document.documentElement.dataset.theme = t;
      }
    } catch {
      /* ignore */
    }
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === "tv-theme" &&
        (e.newValue === "light" ||
          e.newValue === "soft" ||
          e.newValue === "amoled")
      ) {
        document.documentElement.dataset.theme = e.newValue;
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Replay offline playback saves when connectivity returns.
    initPlaybackOutbox();
    if (!("serviceWorker" in navigator)) return;
    // Production: full offline shell. Dev (?dev=1): /api/dl ONLY, so
    // offline-download playback works in dev without the worker touching
    // HMR, navigations or build chunks (see DEV_MODE in public/sw.js).
    const swUrl =
      process.env.NODE_ENV === "production" ? "/sw.js" : "/sw.js?dev=1";

    let cancelled = false;
    let reg: ServiceWorkerRegistration | null = null;

    const onVisible = () => {
      if (document.visibilityState === "visible" && reg) {
        reg.update().catch(() => {});
      }
    };

      navigator.serviceWorker
        .register(swUrl, {
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
      <ThemeHydrator />
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  );
}
