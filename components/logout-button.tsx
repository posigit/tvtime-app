"use client";

import { signOut } from "next-auth/react";

export function LogoutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="w-full rounded-xl border border-white/10 bg-card py-3 text-sm font-medium text-white transition-colors hover:bg-secondary"
    >
      Log out
    </button>
  );
}
