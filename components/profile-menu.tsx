"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { History, MoreHorizontal } from "lucide-react";

/** Profile "⋯" menu: Watch history, Import data + Sign out */
export function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-10 items-center justify-center rounded-full text-white"
        aria-label="More"
      >
        <MoreHorizontal className="h-6 w-6" />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-30 w-44 overflow-hidden rounded-xl border border-white/10 bg-card shadow-xl">
          <Link
            href="/profile/history"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-3 text-left text-sm font-medium text-white hover:bg-secondary"
          >
            <History className="h-4 w-4" />
            Watch history
          </Link>
          <Link
            href="/import"
            onClick={() => setOpen(false)}
            className="block w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-secondary"
          >
            Import data
          </Link>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-secondary"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
