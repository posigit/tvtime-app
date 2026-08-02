"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type Pill = {
  value: string;
  label: string;
};

/** Only ship tabs that have real content — no empty Groups/Activity shells */
const PILLS: Pill[] = [
  { value: "feed", label: "FEED" },
  { value: "discover", label: "DISCOVER" },
];

export function ExplorePills({
  feed,
  discover,
}: {
  feed: React.ReactNode;
  discover: React.ReactNode;
}) {
  const [active, setActive] = useState("feed");

  return (
    <div>
      <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {PILLS.map((pill) => (
          <button
            key={pill.value}
            type="button"
            onClick={() => setActive(pill.value)}
            className={cn(
              "flex-shrink-0 rounded-full px-5 py-2.5 text-sm font-black tracking-wide transition-colors active:scale-95",
              active === pill.value
                ? "bg-primary text-black"
                : "bg-[#2c2c2e] text-white"
            )}
          >
            {pill.label}
          </button>
        ))}
      </div>

      <div className="pt-3">
        {active === "feed" && feed}
        {active === "discover" && discover}
      </div>
    </div>
  );
}
