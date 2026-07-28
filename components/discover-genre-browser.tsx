"use client";

import { useMemo, useState } from "react";
import { SectionLabel } from "@/components/section-label";
import { DiscoverRail } from "@/components/discover-rail";
import type { TmdbMediaCard } from "@/lib/tmdb";
import { cn } from "@/lib/utils";

export type GenreChip = {
  key: string; // e.g. "tv-80" or "movie-28"
  label: string; // e.g. "TV · Crime"
  kind: "tv" | "movie";
  items: TmdbMediaCard[];
};

export function DiscoverGenreBrowser({ genres }: { genres: GenreChip[] }) {
  const defaultKey = genres[0]?.key ?? "";
  const [active, setActive] = useState(defaultKey);

  const selected = useMemo(
    () => genres.find((g) => g.key === active) ?? genres[0],
    [genres, active]
  );

  if (genres.length === 0) return null;

  return (
    <section className="mb-4 mt-4">
      <div className="mb-3">
        <SectionLabel>Browse by genre</SectionLabel>
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {genres.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => setActive(g.key)}
            className={cn(
              "flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
              active === g.key
                ? "bg-primary text-black"
                : "bg-card text-white/80 hover:bg-white/10"
            )}
          >
            {g.label}
          </button>
        ))}
      </div>

      {selected && (
        <div className="mt-4">
          <DiscoverRail
            label={
              selected.kind === "tv"
                ? `${selected.label.replace(/^TV · /, "")} shows`
                : `${selected.label.replace(/^Film · /, "")} movies`
            }
            items={selected.items}
          />
          {selected.items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing new in this genre (or everything is already in your
              library).
            </p>
          )}
        </div>
      )}
    </section>
  );
}
