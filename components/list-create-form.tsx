"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus } from "lucide-react";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/utils";

/**
 * Inline custom-list creator. Rendered in the profile Lists section (both
 * the empty state and as a compact trailing row), so the old dead
 * "Create a new list" CTA actually works now.
 */
export function ListCreateForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = (await res.json()) as { list?: { id: string } };
      if (!res.ok || !data.list) throw new Error("create failed");
      setName("");
      setOpen(false);
      toast("List created");
      router.refresh();
    } catch {
      toast("Couldn't create list", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return compact ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-xl bg-card px-4 py-3 text-left text-sm font-semibold text-primary transition hover:bg-secondary"
      >
        <Plus className="h-4 w-4" />
        New list
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-xl bg-card text-foreground transition hover:bg-secondary"
      >
        <Plus className="h-7 w-7" strokeWidth={2.5} />
        <span className="text-xs font-bold uppercase tracking-wide">
          Create a new list
        </span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl bg-card p-3">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void create();
          if (e.key === "Escape") {
            setOpen(false);
            setName("");
          }
        }}
        maxLength={60}
        placeholder="List name"
        aria-label="New list name"
        className="h-10 min-w-0 flex-1 rounded-full bg-secondary px-4 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/60"
      />
      <button
        type="button"
        onClick={() => void create()}
        disabled={!name.trim() || busy}
        aria-label="Create list"
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-black transition active:scale-95",
          (!name.trim() || busy) && "opacity-50"
        )}
      >
        <Check className="h-4 w-4" strokeWidth={3} />
      </button>
    </div>
  );
}
