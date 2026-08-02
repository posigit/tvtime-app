"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, Search, Tv, User } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/shows", label: "Shows", icon: Tv },
  { href: "/movies", label: "Movies", icon: Clapperboard },
  { href: "/explore", label: "Explore", icon: Search },
  { href: "/profile", label: "Profile", icon: User },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-black pb-safe"
      aria-label="Main"
    >
      <div className="mx-auto flex max-w-md items-center justify-around pt-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex min-h-11 flex-col items-center justify-center gap-0.5 px-4 py-1.5 text-xs transition-colors",
                active ? "text-white" : "text-muted-foreground"
              )}
            >
              <Icon className="h-6 w-6" strokeWidth={active ? 2.5 : 2} />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
