"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/toast";

type ListRow = {
  id: string;
  name: string;
  count: number;
  type: string;
  contains?: boolean;
};

/**
 * Bookmark button + bottom sheet for custom lists. Liquid-glass circle
 * matching FavoriteButton; sheet lists custom lists with contained checks,
 * tap toggles membership, inline row creates.
 */
export function AddToListButton({
  mediaType,
  tmdbId,
  title,
  posterPath,
}: {
  mediaType: "show" | "movie";
  tmdbId: number;
  title: string;
  posterPath: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<ListRow[] | null>(null);
  const [listsError, setListsError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const inAny = lists?.some((l) => l.contains) ?? false;

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/lists?tmdbId=${tmdbId}&mediaType=${mediaType}`
      );
      if (!res.ok) throw new Error("lists failed");
      const data = (await res.json()) as { lists?: ListRow[] };
      setLists((data.lists ?? []).filter((l) => l.type === "custom"));
      setListsError(false);
    } catch {
      // Never strand on "Loading…": show the error + create row instead.
      setLists([]);
      setListsError(true);
    }
  }, [tmdbId, mediaType]);

  useEffect(() => {
    if (!open) return;
    // Deferred (not sync setState): load() flips list state on resolve.
    queueMicrotask(() => {
      void load();
    });
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const node = e.target as Node | null;
      if (sheetRef.current && node && !sheetRef.current.contains(node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer, { passive: true });
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open ]);

  const toggle = async (list: ListRow) => {
    if (busyId) return;
    setBusyId(list.id);
    try {
      if (list.contains) {
        const res = await fetch(
          `/api/lists/${list.id}/items?tmdbId=${tmdbId}&mediaType=${mediaType}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error("remove failed");
        toast(`Removed from ${list.name}`);
      } else {
        const res = await fetch(`/api/lists/${list.id}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tmdbId, mediaType, title, posterPath }),
        });
        if (!res.ok) throw new Error("add failed");
        toast(`Saved to ${list.name}`);
      }
      await load();
      router.refresh();
    } catch {
      toast("Couldn't update list", "error");
    } finally {
      setBusyId(null);
    }
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busyId) return;
    setBusyId("new");
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = (await res.json()) as { list?: { id: string } };
      if (!res.ok || !data.list) throw new Error("create failed");
      setName("");
      setCreating(false);
      await load();
      router.refresh();
    } catch {
      toast("Couldn't create list", "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          try {
            navigator.vibrate?.(10);
          } catch {
            /* ignore */
          }
          setOpen(true);
        }}
        aria-label="Add to list"
        title="Add to list"
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-xl transition-all active:scale-90",
          inAny
            ? "bg-primary/25 text-primary ring-1 ring-primary/50 shadow-[0_8px_24px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.3)]"
            : "bg-white/[0.12] text-white ring-1 ring-white/30 shadow-[0_8px_24px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.25)] hover:bg-white/25"
        )}
      >
        <Bookmark
          className="h-4 w-4"
          strokeWidth={inAny ? 2.5 : 2}
          fill={inAny ? "currentColor" : "none"}
        />
      </button>
      {open && (
        <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="Add to list">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <div
            ref={sheetRef}
            className="absolute inset-x-3 bottom-3 max-h-[70dvh] overflow-y-auto rounded-2xl border border-white/15 bg-[#1c1c1e]/95 shadow-2xl backdrop-blur-2xl"
          >
            <div className="flex items-center justify-between px-4 pb-1 pt-3.5">
              <p className="text-sm font-black text-white">Save to list</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {lists == null ? (
              <p className="px-4 py-6 text-center text-sm text-white/45">Loading…</p>
            ) : (
              <>
                {listsError && (
                  <p className="px-4 pb-1 pt-2 text-center text-xs font-semibold text-red-400">
                    Couldn&apos;t load lists — check connection, or create one below
                  </p>
                )}
              <div className="py-1">
                {lists.length === 0 && !listsError && !creating && (
                  <p className="px-4 py-4 text-center text-sm text-white/45">
                    No lists yet — tap New list below
                  </p>
                )}
                {lists.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    disabled={busyId === l.id}
                    onClick={() => void toggle(l)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-white/10 disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-white">
                        {l.name}
                      </span>
                      <span className="block text-[11px] text-white/40">
                        {l.count} {l.count === 1 ? "title" : "titles"}
                      </span>
                    </span>
                    {l.contains ? (
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Plus className="h-4 w-4 shrink-0 text-white/40" />
                    )}
                  </button>
                ))}
                {creating ? (
                  <div className="flex items-center gap-2 px-4 py-2.5">
                    <input
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void create();
                      }}
                      maxLength={60}
                      placeholder="List name"
                      aria-label="New list name"
                      className="h-9 min-w-0 flex-1 rounded-full bg-white/10 px-3.5 text-sm text-white placeholder:text-white/35 focus:outline-none focus:ring-1 focus:ring-primary/60"
                    />
                    <button
                      type="button"
                      onClick={() => void create()}
                      disabled={!name.trim() || busyId === "new"}
                      className="flex h-9 shrink-0 items-center rounded-full bg-primary px-4 text-sm font-bold text-black disabled:opacity-50"
                    >
                      Create
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-primary transition hover:bg-white/10"
                  >
                    <Plus className="h-4 w-4" />
                    New list
                  </button>
                )}
              </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
