"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { posterUrl, stillUrl } from "@/lib/tmdb";
import { MarkWatchedButton } from "@/components/mark-watched-button";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
} from "lucide-react";

export type CalendarEpisode = {
  tmdbId: number;
  showTitle: string;
  posterPath: string | null;
  stillPath: string | null;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string;
  airDate: string;
  aired: boolean;
  watched: boolean;
  isPremiere: boolean;
  daysUntil: number;
};

export type CalendarDay = {
  /** YYYY-MM-DD */
  date: string;
  day: number;
  inMonth: boolean;
  episodes: CalendarEpisode[];
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function epKey(ep: CalendarEpisode) {
  return `${ep.tmdbId}:${ep.seasonNumber}:${ep.episodeNumber}`;
}

/**
 * Month-grid calendar: every cell shows what aired/airs that day
 * (watched included — that's what makes it different from Upcoming).
 */
export function CalendarMonth({
  monthLabel,
  days,
  today,
  prevHref,
  nextHref,
}: {
  monthLabel: string;
  days: CalendarDay[];
  today: string;
  prevHref: string;
  nextHref: string;
}) {
  const firstWithEps = days.find((d) => d.inMonth && d.episodes.length > 0);
  const [selected, setSelected] = useState<string>(
    days.some((d) => d.date === today) ? today : (firstWithEps?.date ?? today)
  );
  const [justWatched, setJustWatched] = useState<Set<string>>(new Set());

  const selectedDay = useMemo(
    () => days.find((d) => d.date === selected) ?? null,
    [days, selected]
  );

  return (
    <div>
      {/* Month header + nav */}
      <div className="mb-4 flex items-center justify-between">
        <Link
          href={prevHref}
          aria-label="Previous month"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h2 className="text-base font-black uppercase tracking-wide text-white">
          {monthLabel}
        </h2>
        <Link
          href={nextHref}
          aria-label="Next month"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <ChevronRight className="h-5 w-5" />
        </Link>
      </div>

      {/* Weekday header */}
      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d, i) => (
          <p
            key={i}
            className="text-center text-[10px] font-bold uppercase tracking-wider text-white/30"
          >
            {d}
          </p>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const isToday = day.date === today;
          const isSelected = day.date === selected;
          const eps = day.episodes;
          const thumbs = eps.slice(0, 2);
          const extra = eps.length - thumbs.length;
          return (
            <button
              key={day.date}
              type="button"
              onClick={() => setSelected(day.date)}
              disabled={!day.inMonth}
              className={cn(
                "relative flex aspect-[0.72] flex-col overflow-hidden rounded-lg p-1 text-left ring-1 transition",
                day.inMonth
                  ? "bg-[#101011] ring-white/[0.06] active:scale-[0.97]"
                  : "bg-transparent ring-transparent",
                isSelected && day.inMonth && "ring-2 ring-primary",
                isToday && !isSelected && day.inMonth && "ring-1 ring-white/50"
              )}
            >
              <span
                className={cn(
                  "text-[10px] font-bold leading-none",
                  !day.inMonth
                    ? "text-white/15"
                    : isToday
                      ? "text-primary"
                      : "text-white/60"
                )}
              >
                {day.day}
              </span>
              {day.inMonth && eps.length > 0 && (
                <div className="mt-1 flex flex-1 flex-col gap-0.5 overflow-hidden">
                  {thumbs.map((ep) => {
                    const img =
                      posterUrl(ep.posterPath, "w92") ??
                      stillUrl(ep.stillPath, "w92");
                    const watchedNow = ep.watched || justWatched.has(epKey(ep));
                    return (
                      <div
                        key={epKey(ep)}
                        className={cn(
                          "relative w-full flex-1 overflow-hidden rounded-[4px] bg-[#2c2c2e]",
                          watchedNow && "opacity-35"
                        )}
                      >
                        {img ? (
                          <Image
                            src={img}
                            alt=""
                            fill
                            sizes="44px"
                            className="object-cover"
                            unoptimized
                          />
                        ) : null}
                      </div>
                    );
                  })}
                  {extra > 0 && (
                    <span className="text-[8px] font-black leading-none text-white/50">
                      +{extra}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected day episodes */}
      <div className="mt-5">
        {selectedDay && selectedDay.episodes.length > 0 ? (
          <div className="space-y-2">
            {selectedDay.episodes.map((ep) => {
              const still = stillUrl(ep.stillPath, "w300");
              const poster = posterUrl(ep.posterPath, "w154");
              const watchedNow = ep.watched || justWatched.has(epKey(ep));
              return (
                <div
                  key={epKey(ep)}
                  className="flex items-center gap-3 rounded-xl bg-[#101011] p-2.5"
                >
                  <Link
                    href={`/show/${ep.tmdbId}`}
                    className="relative h-[72px] w-[116px] flex-shrink-0 overflow-hidden rounded-lg bg-[#2c2c2e]"
                  >
                    {still ? (
                      <Image
                        src={still}
                        alt={ep.showTitle}
                        fill
                        sizes="116px"
                        className="object-cover"
                        unoptimized
                      />
                    ) : poster ? (
                      <Image
                        src={poster}
                        alt={ep.showTitle}
                        fill
                        sizes="116px"
                        className="object-cover"
                        unoptimized
                      />
                    ) : null}
                  </Link>

                  <Link
                    href={`/show/${ep.tmdbId}`}
                    className="min-w-0 flex-1 py-0.5"
                  >
                    <div className="mb-1.5 inline-flex max-w-full items-center gap-0.5 rounded-full border border-white/90 px-2.5 py-[3px]">
                      <span className="truncate text-[11px] font-bold uppercase tracking-wide text-white">
                        {ep.showTitle}
                      </span>
                      <ChevronRight
                        className="h-3 w-3 flex-shrink-0 text-white"
                        strokeWidth={2.5}
                      />
                    </div>
                    <p className="text-[15px] font-bold leading-tight text-white">
                      S{String(ep.seasonNumber).padStart(2, "0")} | E
                      {String(ep.episodeNumber).padStart(2, "0")}
                    </p>
                    <p className="truncate text-[13px] leading-tight text-muted-foreground">
                      {ep.episodeTitle}
                    </p>
                    {ep.isPremiere && (
                      <span className="mt-1.5 inline-block rounded-md bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-black">
                        Premiere
                      </span>
                    )}
                  </Link>

                  {watchedNow ? (
                    <div
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"
                      title="Watched"
                    >
                      <Check className="h-4 w-4" strokeWidth={3} />
                    </div>
                  ) : ep.aired ? (
                    <MarkWatchedButton
                      showTmdbId={ep.tmdbId}
                      seasonNumber={ep.seasonNumber}
                      episodeNumber={ep.episodeNumber}
                      onWatched={() =>
                        setJustWatched((prev) => new Set(prev).add(epKey(ep)))
                      }
                      onWatchFailed={() =>
                        setJustWatched((prev) => {
                          const next = new Set(prev);
                          next.delete(epKey(ep));
                          return next;
                        })
                      }
                    />
                  ) : (
                    <div
                      className="flex w-14 flex-shrink-0 flex-col items-center justify-center"
                      title={
                        ep.daysUntil === 0
                          ? "Today"
                          : `${ep.daysUntil} day${ep.daysUntil === 1 ? "" : "s"}`
                      }
                    >
                      <span className="text-2xl font-black leading-none text-white">
                        {ep.daysUntil}
                      </span>
                      <span className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <Clock className="h-2.5 w-2.5" />
                        {ep.daysUntil === 1 ? "day" : "days"}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nothing on this day
          </p>
        )}
      </div>
    </div>
  );
}
