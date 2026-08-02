"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Clapperboard, Search, Tv, User } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/shows", label: "Shows", icon: Tv },
  { href: "/movies", label: "Movies", icon: Clapperboard },
  { href: "/explore", label: "Explore", icon: Search },
  { href: "/profile", label: "Profile", icon: User },
] as const;

function isTabActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function scrollPageToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
  document
    .querySelectorAll<HTMLElement>("[data-scroll-root]")
    .forEach((el) => {
      el.scrollTo({ top: 0, behavior: "smooth" });
    });
}

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-black pb-safe"
      aria-label="Main"
    >
      <div className="mx-auto flex max-w-md items-center justify-around pt-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isTabActive(pathname, tab.href);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              onClick={(e) => {
                // Re-tap active tab → scroll to top (native app pattern)
                if (active) {
                  e.preventDefault();
                  if (pathname !== tab.href) {
                    router.push(tab.href);
                    requestAnimationFrame(() => scrollPageToTop());
                  } else {
                    scrollPageToTop();
                  }
                }
              }}
              className={cn(
                "flex min-h-11 min-w-[4.25rem] flex-col items-center justify-center gap-0.5 px-3 py-1.5 text-xs transition-colors active:scale-95",
                active ? "text-white" : "text-muted-foreground"
              )}
            >
              <Icon
                className="h-6 w-6"
                strokeWidth={active ? 2.5 : 2}
              />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
