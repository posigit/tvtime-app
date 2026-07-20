"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type Pill = {
  value: string;
  label: string;
};

const PILLS: Pill[] = [
  { value: "feed", label: "FEED" },
  { value: "discover", label: "DISCOVER" },
  { value: "groups", label: "GROUPS" },
  { value: "activity", label: "ACTIVITY" },
];

/** Snapshot 5 pill row: FEED active (yellow), others dark, horizontally scrollable */
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
            onClick={() => setActive(pill.value)}
            className={cn(
              "flex-shrink-0 rounded-full px-5 py-2.5 text-sm font-black tracking-wide transition-colors",
              active === pill.value
                ? "bg-primary text-black"
                : "bg-[#2c2c2e] text-white"
            )}
          >
            {pill.label}
          </button>
        ))}
      </div>

      <div className="pt-2">
        {active === "feed" && feed}
        {active === "discover" && discover}
        {active === "groups" && (
          <p className="pt-20 text-center text-sm text-muted-foreground">
            No groups yet
          </p>
        )}
        {active === "activity" && (
          <p className="pt-20 text-center text-sm text-muted-foreground">
            No activity yet
          </p>
        )}
      </div>
    </div>
  );
}
