"use client";

import { cn } from "@/lib/utils";

type Segment<T extends string> = {
  value: T;
  label: string;
};

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-2 rounded-full bg-card p-1">
      {segments.map((seg) => (
        <button
          key={seg.value}
          onClick={() => onChange(seg.value)}
          className={cn(
            "flex-1 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
            value === seg.value
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
