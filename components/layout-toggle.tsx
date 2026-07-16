"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutGrid, List } from "lucide-react";

export function LayoutToggle() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const layout = searchParams.get("layout") === "list" ? "list" : "grid";

  const setLayout = (value: "grid" | "list") => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("layout", value);
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="flex rounded-lg border border-white/10 bg-card p-1">
      <button
        onClick={() => setLayout("grid")}
        className={cn(
          "rounded px-2 py-1 transition-colors",
          layout === "grid" ? "bg-white/10 text-white" : "text-muted-foreground"
        )}
        aria-label="Grid view"
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
      <button
        onClick={() => setLayout("list")}
        className={cn(
          "rounded px-2 py-1 transition-colors",
          layout === "list" ? "bg-white/10 text-white" : "text-muted-foreground"
        )}
        aria-label="List view"
      >
        <List className="h-4 w-4" />
      </button>
    </div>
  );
}
