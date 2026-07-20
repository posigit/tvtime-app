"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/** 2x2 grid icon toggle — yellow in grid mode (snapshot 3), white in list mode (snapshot 1) */
export function LayoutToggle() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isGrid = searchParams.get("layout") === "grid";

  const toggle = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("layout", isGrid ? "list" : "grid");
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
