"use client";

import { useCallback, useEffect, useState } from "react";
import { Contrast, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export type ThemeId = "amoled" | "soft" | "light";

const STORAGE_KEY = "tv-theme";

export function getSavedTheme(): ThemeId {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    if (t === "light" || t === "soft" || t === "amoled") return t;
  } catch {
    /* ignore */
  }
  return "amoled";
}

export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", theme === "light" ? "#f4f4f6" : "#000000");
  }
}

const OPTIONS: Array<{ id: ThemeId; label: string; Icon: typeof Moon }> = [
  { id: "amoled", label: "AMOLED", Icon: Moon },
  { id: "soft", label: "Soft dark", Icon: Contrast },
  { id: "light", label: "Light", Icon: Sun },
];

/** Segmented AMOLED / Soft dark / Light switch. Persists to localStorage. */
export function ThemeToggle({
  compact = false,
  layout = "segmented",
}: {
  compact?: boolean;
  /** "stacked" = full-width vertical rows (fits narrow menus / small screens). */
  layout?: "segmented" | "stacked";
}) {
  const [theme, setTheme] = useState<ThemeId>("amoled");

  useEffect(() => {
    setTheme(getSavedTheme());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === "light" || e.newValue === "soft" || e.newValue === "amoled")) {
        setTheme(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const pick = useCallback((id: ThemeId) => {
    setTheme(id);
    applyTheme(id);
    try {
      navigator.vibrate?.(8);
    } catch {
      /* ignore */
    }
  }, []);

  if (layout === "stacked") {
    return (
      <div role="radiogroup" aria-label="Appearance" className="flex flex-col gap-1">
        {OPTIONS.map(({ id, label, Icon }) => {
          const active = theme === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => pick(id)}
              className={cn(
                "flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-semibold transition active:scale-[0.99]",
                active
                  ? "bg-primary text-black"
                  : "text-foreground hover:bg-secondary"
              )}
            >
              <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={2.5} />
              <span className="flex-1">{label}</span>
              {active && (
                <span aria-hidden="true" className="text-base font-black leading-none">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className={cn(
        "flex items-center gap-1 rounded-full bg-secondary p-1",
        compact ? "" : "w-full"
      )}
    >
      {OPTIONS.map(({ id, label, Icon }) => {
        const active = theme === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => pick(id)}
            className={cn(
              "flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-2 text-[11px] font-bold transition active:scale-95 sm:min-h-0",
              active
                ? "bg-primary text-black shadow"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
            {!compact && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
