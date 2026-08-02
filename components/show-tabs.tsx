"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

type Tab = {
  value: string;
  label: string;
};

export function ShowTabs({ tabs }: { tabs: Tab[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("view") || tabs[0].value;

  return (
    <div className="relative flex">
      {tabs.map((tab) => {
        const active = current === tab.value;
        return (
          <button
            key={tab.value}
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              params.set("view", tab.value);
              router.push(`?${params.toString()}`);
            }}
            className={cn(
              "relative flex-1 pb-3 pt-2 text-center text-sm font-bold tracking-wide transition-colors active:scale-[0.98]",
              active ? "text-white" : "text-muted-foreground hover:text-white"
            )}
          >
            {tab.label}
            {active && (
              <span className="absolute bottom-0 left-1/2 h-0.5 w-12 -translate-x-1/2 rounded-full bg-primary" />
            )}
          </button>
        );
      })}
    </div>
  );
}
