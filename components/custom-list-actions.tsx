"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/utils";

/** Rename + delete controls for a custom list page header. */
export function CustomListHeader({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const save = async () => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/lists/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error("rename failed");
      setEditing(false);
      toast("List renamed");
      router.refresh();
    } catch {
      toast("Couldn't rename list", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/lists/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      toast("List deleted");
      router.push("/profile");
      router.refresh();
    } catch {
      toast("Couldn't delete list", "error");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (editing) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") {
              setEditing(false);
              setValue(name);
            }
          }}
          maxLength={60}
          aria-label="List name"
          className="h-9 min-w-0 flex-1 rounded-full bg-white/10 px-3.5 text-base font-bold text-white focus:outline-none focus:ring-1 focus:ring-primary/60"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={!value.trim() || busy}
          aria-label="Save name"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-black disabled:opacity-50"
        >
          <Check className="h-4 w-4" strokeWidth={3} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={() => {
          setValue(name);
          setEditing(true);
        }}
        aria-label="Rename list"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-white/70 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
      >
        <Pencil className="h-4 w-4" />
      </button>
      {confirming ? (
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          aria-label="Confirm delete"
          className="flex h-9 items-center gap-1.5 rounded-full bg-red-500/20 px-3.5 text-xs font-black uppercase tracking-wide text-red-300 ring-1 ring-red-400/40 transition hover:bg-red-500/30 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          Sure?
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label="Delete list"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-white/70 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** Remove-one-title button overlaid on a custom-list poster. */
export function RemoveListItemButton({
  listId,
  tmdbId,
  mediaType,
  title,
}: {
  listId: string;
  tmdbId: number;
  mediaType: "show" | "movie";
  title: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);

  if (gone) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        if (busy) return;
        setBusy(true);
        void (async () => {
          try {
            const res = await fetch(
              `/api/lists/${listId}/items?tmdbId=${tmdbId}&mediaType=${mediaType}`,
              { method: "DELETE" }
            );
            if (!res.ok) throw new Error("remove failed");
            setGone(true);
            router.refresh();
          } catch {
            toast(`Couldn't remove ${title}`, "error");
            setBusy(false);
          }
        })();
      }}
      aria-label={`Remove ${title} from list`}
      className={cn(
        "absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white/80 ring-1 ring-white/20 backdrop-blur transition hover:bg-black/90 hover:text-white active:scale-95",
        busy && "opacity-50"
      )}
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}
