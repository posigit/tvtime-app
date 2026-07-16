"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

type Segment = {
  value: string;
  label: string;
};

export function ViewToggle({ segments }: { segments: Segment[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("view") || segments[0].value;

  return (
    <div className="flex gap-2 rounded-full bg-card p-1">
      {segments.map((seg) => (
        <button
          key={seg.value}
          onClick={() => {
            const params = new URLSearchParams(searchParams.toString());
            params.set("view", seg.value);
            router.push(`?${params.toString()}`);
          }}
          className={cn(
            "flex-1 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
            current === seg.value
              ? "bg-primary text-black"
              : "text-muted-foreground hover:text-white"
          )}
        >
          {seg.label}
        </button>
      ))}
    </div>
  );
}
