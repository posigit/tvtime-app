"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { SectionLabel } from "@/components/section-label";
import { MarkWatchedButton } from "@/components/mark-watched-button";
import { posterUrl } from "@/lib/tmdb";

export type UpcomingListItem = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string;
  airDate: string;
  isPremiere: boolean;
  isLatest: boolean;
  aired: boolean;
  countdown: string;
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
 * Upcoming episodes grouped by calendar day.
 * On mount, scrolls so today's group (or nearest upcoming day) is in view.
 */
export function UpcomingList({ groups }: { groups: UpcomingGroup[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const today = todayKey();

  useEffect(() => {
    if (groups.length === 0) return;

    // Prefer exact today; else first day on/after today; else last group (all past)
    let targetKey = groups.find((g) => g.dateKey === today)?.dateKey;
    if (!targetKey) {
      targetKey = groups.find((g) => g.dateKey >= today)?.dateKey;
    }
    if (!targetKey) {
      targetKey = groups[groups.length - 1]?.dateKey;
    }
    if (!targetKey) return;

    // Wait a frame so layout is ready
    const id = requestAnimationFrame(() => {
      const el = document.getElementById(`upcoming-date-${targetKey}`);
      if (!el) return;
      // Offset for sticky tabs (~100px)
      const top =
        el.getBoundingClientRect().top + window.scrollY - 100;
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
            <SectionLabel>
              {group.dateKey === today ? `Today · ${group.label}` : group.label}
            </SectionLabel>
          </div>
          <div className="space-y-2">
            {group.items.map((item) => (
              <div
                key={`${item.tmdbId}-${item.seasonNumber}-${item.episodeNumber}`}
                className="flex items-center gap-3 rounded-xl bg-[#111112] p-3"
              >
                <Link
                  href={`/show/${item.tmdbId}`}
                  className="relative flex-shrink-0 overflow-hidden rounded-lg bg-[#2c2c2e]"
                  style={{ width: 56, height: 84 }}
                >
                  {item.posterPath ? (
                    <Image
                      src={posterUrl(item.posterPath, "w154") ?? ""}
                      alt={item.title}
                      width={56}
                      height={84}
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
                  className="min-w-0 flex-1"
                >
                  <div className="mb-1.5 inline-flex items-center gap-1 rounded-full border border-white/80 px-2.5 py-0.5 text-xs font-bold text-white">
                    {item.title}
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                  <p className="text-sm font-bold text-white">
                    S{String(item.seasonNumber).padStart(2, "0")} | E
                    {String(item.episodeNumber).padStart(2, "0")}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.episodeTitle}
                  </p>
                  {(item.isPremiere || item.isLatest) && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {item.isPremiere && (
                        <span className="rounded border border-white/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                          Premiere
                        </span>
                      )}
                      {item.isLatest && (
                        <span className="rounded border border-white/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
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
                    className="flex h-10 min-w-10 flex-shrink-0 items-center justify-center rounded-full border border-white/20 px-1 text-center text-[9px] font-medium leading-tight text-muted-foreground"
                    title={item.countdown}
                  >
                    {item.countdown}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
