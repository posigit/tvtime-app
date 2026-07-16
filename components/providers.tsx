"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode, useEffect } from "react";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return <SessionProvider>{children}</SessionProvider>;
}
