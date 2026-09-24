"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

type Tab = {
  value: string;
  label: string;
};

export function ShowTabs({ tabs }: { tabs: Tab[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("view") || tabs[0].value;
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const pick = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("view", value);
      // Tab switch must not scroll — keep the user's position.
      router.push(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      // Arrow-key tablist navigation (roving focus).
      let next: number | null = null;
      if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabs.length - 1;
      if (next == null) return;
      e.preventDefault();
      btnRefs.current[next]?.focus();
      pick(tabs[next].value);
    },
    [pick, tabs]
  );

  return (
    <div role="tablist" aria-label="Views" className="relative flex">
      {tabs.map((tab, i) => {
        const active = current === tab.value;
        return (
          <button
            key={tab.value}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => pick(tab.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "relative flex-1 pb-3 pt-2 text-center text-sm font-bold tracking-wide transition-colors active:scale-[0.98]",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            {active && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground" />
            )}
          </button>
        );
      })}
    </div>
  );
}
