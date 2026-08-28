"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  setExploreTabCookie,
  type ExploreTab,
} from "@/lib/explore-tab";

const PILLS: { value: ExploreTab; label: string }[] = [
  { value: "feed", label: "FEED" },
  { value: "discover", label: "DISCOVER" },
];

export function ExplorePills({ active }: { active: ExploreTab }) {
  return (
    <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {PILLS.map((pill) => {
        const selected = active === pill.value;
        return (
          <Link
            key={pill.value}
            href={`/explore?tab=${pill.value}`}
            replace
            prefetch={false}
            onClick={() => setExploreTabCookie(pill.value)}
            className={cn(
              "flex-shrink-0 rounded-full px-5 py-2.5 text-sm font-black tracking-wide transition-colors active:scale-95",
              selected ? "bg-primary text-black" : "bg-[#2c2c2e] text-white"
            )}
            aria-current={selected ? "page" : undefined}
          >
            {pill.label}
          </Link>
        );
      })}
    </div>
  );
}
