"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { SectionLabel } from "@/components/section-label";
import { MarkWatchedButton } from "@/components/mark-watched-button";
import { posterUrl, stillUrl } from "@/lib/tmdb";
import { ChevronRight } from "lucide-react";

export type UpcomingListItem = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string;
  stillPath: string | null;
  airDate: string;
  isPremiere: boolean;
  isLatest: boolean;
  aired: boolean;
  daysUntil: number;
};

export type UpcomingGroup = {
  dateKey: string;
  label: string;
  items: UpcomingListItem[];
};

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Upcoming episodes grouped by calendar day (snapshot 2).
 * Unaired rows show the big "N DAYS" counter on the right (e2 style);
 * aired rows get the white check circle.
 */
export function UpcomingList({ groups }: { groups: UpcomingGroup[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const today = todayKey();

  useEffect(() => {
    if (groups.length === 0) return;

    let targetKey = groups.find((g) => g.dateKey === today)?.dateKey;
    if (!targetKey) {
      targetKey = groups.find((g) => g.dateKey >= today)?.dateKey;
    }
    if (!targetKey) {
      targetKey = groups[groups.length - 1]?.dateKey;
    }
    if (!targetKey) return;

    const id = requestAnimationFrame(() => {
      const el = document.getElementById(`upcoming-date-${targetKey}`);
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY - 100;
      window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
    });

    return () => cancelAnimationFrame(id);
  }, [groups, today]);

  return (
    <div ref={containerRef} className="space-y-6">
      {groups.map((group) => (
        <section
          key={group.dateKey}
          id={`upcoming-date-${group.dateKey}`}
          data-date={group.dateKey}
        >
          <div className="mb-3 flex justify-center">
            <SectionLabel>{group.label}</SectionLabel>
          </div>
          <div className="space-y-2">
            {group.items.map((item) => {
              const still = stillUrl(item.stillPath, "w300");
              const poster = posterUrl(item.posterPath, "w154");
              return (
                <div
                  key={`${item.tmdbId}-${item.seasonNumber}-${item.episodeNumber}`}
                  className="flex items-center gap-3 rounded-xl bg-[#101011] p-2.5"
                >
                  <Link
                    href={`/show/${item.tmdbId}`}
                    className="relative h-[72px] w-[116px] flex-shrink-0 overflow-hidden rounded-lg bg-[#2c2c2e]"
                  >
                    {still ? (
                      <Image
                        src={still}
                        alt={item.title}
                        fill
                        sizes="116px"
                        className="object-cover"
                        unoptimized
                      />
                    ) : poster ? (
                      <Image
                        src={poster}
                        alt={item.title}
                        fill
                        sizes="116px"
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                        No img
                      </div>
                    )}
                  </Link>

                  <Link
                    href={`/show/${item.tmdbId}`}
                    className="min-w-0 flex-1 py-0.5"
                  >
                    <div className="mb-1.5 inline-flex max-w-full items-center gap-0.5 rounded-full border border-white/90 px-2.5 py-[3px]">
                      <span className="truncate text-[11px] font-bold uppercase tracking-wide text-white">
                        {item.title}
                      </span>
                      <ChevronRight
                        className="h-3 w-3 flex-shrink-0 text-white"
                        strokeWidth={2.5}
                      />
                    </div>
                    <p className="text-[15px] font-bold leading-tight text-white">
                      S{String(item.seasonNumber).padStart(2, "0")} | E
                      {String(item.episodeNumber).padStart(2, "0")}
                    </p>
                    <p className="truncate text-[13px] leading-tight text-muted-foreground">
                      {item.episodeTitle}
                    </p>
                    {(item.isPremiere || item.isLatest) && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {item.isPremiere && (
                          <span className="rounded-md bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-black">
                            Premiere
                          </span>
                        )}
                        {item.isLatest && (
                          <span className="rounded-md bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-black">
                            Latest
                          </span>
                        )}
                      </div>
                    )}
                  </Link>

                  {item.aired ? (
                    <MarkWatchedButton
                      showTmdbId={item.tmdbId}
                      seasonNumber={item.seasonNumber}
                      episodeNumber={item.episodeNumber}
                    />
                  ) : (
                    <div
                      className="flex w-14 flex-shrink-0 flex-col items-center justify-center"
                      title={
                        item.daysUntil === 0
                          ? "Today"
                          : `${item.daysUntil} day${item.daysUntil === 1 ? "" : "s"}`
                      }
                    >
                      <span className="text-2xl font-black leading-none text-white">
                        {item.daysUntil}
                      </span>
                      <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {item.daysUntil === 1 ? "day" : "days"}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
