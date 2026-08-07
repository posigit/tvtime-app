"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/utils";

const REACTIONS = [
  { key: "like", emoji: "👍", label: "Like" },
  { key: "love", emoji: "❤️", label: "Love" },
  { key: "lol", emoji: "😂", label: "Haha" },
  { key: "wow", emoji: "😮", label: "Wow" },
  { key: "sad", emoji: "😢", label: "Sad" },
  { key: "mad", emoji: "😡", label: "Mad" },
] as const;

type ItemRef =
  | { type: "episode"; showTmdbId: number; seasonNumber: number; episodeNumber: number }
  | { type: "movie"; tmdbId: number };

/**
 * Emoji reaction picker for episodes and movies. Toggles one reaction per key
 * via POST /api/reactions. `initialKeys` comes from the server (the user's
 * existing reactions for this item).
 */
export function ReactionPicker({
  item,
  initialKeys,
  size = "sm",
}: {
  item: ItemRef;
  initialKeys?: string[];
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [active, setActive] = useState<Set<string>>(
    () => new Set(initialKeys ?? [])
  );
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const toggle = async (key: string) => {
    if (pendingKey) return;
    setPendingKey(key);
    try {
      const res = await fetch("/api/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...item, reactionKey: key }),
      });
      if (!res.ok) throw new Error("reaction failed");
      const data = (await res.json()) as { active: boolean };
      setActive((prev) => {
        const next = new Set(prev);
        if (data.active) next.add(key);
        else next.delete(key);
        return next;
      });
      router.refresh();
    } catch {
      toast("Couldn't update reaction — try again", "error");
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Reactions">
      {REACTIONS.map((r) => {
        const on = active.has(r.key);
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => toggle(r.key)}
            disabled={pendingKey !== null}
            aria-label={`${r.label} ${on ? "added" : "add"}`}
            aria-pressed={on}
            title={r.label}
            className={cn(
              "flex items-center justify-center rounded-full transition-all",
              size === "md" ? "h-9 w-9 text-lg" : "h-8 w-8 text-base",
              on
                ? "bg-success/20 ring-1 ring-success"
                : "bg-card ring-1 ring-white/10 hover:bg-secondary",
              pendingKey !== null && "opacity-60"
            )}
          >
            {r.emoji}
          </button>
        );
      })}
    </div>
  );
}