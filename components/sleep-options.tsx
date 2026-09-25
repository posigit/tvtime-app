"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type SleepOption = number | "episode" | null;

export const SLEEP_OPTIONS = [
  { label: "Off", value: null },
  { label: "15 minutes", value: 15 },
  { label: "30 minutes", value: 30 },
  { label: "45 minutes", value: 45 },
  { label: "60 minutes", value: 60 },
  { label: "End of episode", value: "episode" },
] as const;

/** Short sleep status for pills ("Off" / "25m left" / "After episode"). */
export function sleepStatusLabel(
  sleepAfterEpisode: boolean,
  sleepUntil: number | null,
  now: number
): string {
  if (sleepAfterEpisode) return "After episode";
  if (sleepUntil != null) {
    return `${Math.max(1, Math.ceil((sleepUntil - now) / 60000))}m left`;
  }
  return "Off";
}

function isSleepOptionActive(
  value: (typeof SLEEP_OPTIONS)[number]["value"],
  sleepAfterEpisode: boolean,
  sleepUntil: number | null
): boolean {
  if (value === "episode") return sleepAfterEpisode;
  if (value == null) return sleepUntil == null && !sleepAfterEpisode;
  return sleepUntil != null && !sleepAfterEpisode;
}

/**
 * Sleep option rows shared by the transport bottom-bar dropdown and the
 * mobile More sheet. Module-level (no remount/focus loss on parent renders).
 */
export function SleepOptionList({
  sleepAfterEpisode,
  sleepUntil,
  onPick,
  rowClassName,
}: {
  sleepAfterEpisode: boolean;
  sleepUntil: number | null;
  onPick: (opt: SleepOption) => void;
  rowClassName?: string;
}) {
  return (
    <>
      {SLEEP_OPTIONS.map((opt) => {
        const active = isSleepOptionActive(
          opt.value,
          sleepAfterEpisode,
          sleepUntil
        );
        return (
          <button
            key={opt.label}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            onClick={(e) => {
              e.stopPropagation();
              onPick(opt.value);
            }}
            className={cn(
              "flex w-full items-center justify-between py-2.5 pl-11 pr-4 text-left text-sm font-medium text-white transition hover:bg-white/10",
              active && "text-primary",
              rowClassName
            )}
          >
            {opt.label}
            {active && <Check className="h-4 w-4 flex-shrink-0" />}
          </button>
        );
      })}
    </>
  );
}
