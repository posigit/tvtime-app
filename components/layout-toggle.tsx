"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  type LayoutPref,
  type LayoutScope,
  parseLayoutPref,
  setLayoutCookie,
} from "@/lib/layout-pref";

/** 2x2 grid icon toggle — yellow in grid mode, white in list mode */
export function LayoutToggle({
  scope,
  initialLayout,
}: {
  /** Independent pref for Shows vs Movies */
  scope: LayoutScope;
  /** Server-resolved preference when URL has no ?layout= */
  initialLayout?: LayoutPref;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromUrl = parseLayoutPref(searchParams.get("layout"));
  const isGrid = (fromUrl ?? initialLayout ?? "list") === "grid";

  const toggle = () => {
    const next: LayoutPref = isGrid ? "list" : "grid";
    setLayoutCookie(scope, next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("layout", next);
    router.push(`?${params.toString()}`);
  };

  return (
    <button
      onClick={toggle}
      aria-label={isGrid ? "Switch to list view" : "Switch to grid view"}
      className={cn(
        "p-1 transition-colors",
        isGrid ? "text-primary" : "text-white"
      )}
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
        <rect x="3" y="3" width="8" height="8" rx="1.5" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" />
      </svg>
    </button>
  );
}
