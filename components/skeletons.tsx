import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { StickyChrome } from "@/components/sticky-chrome";

/** Base pulse block — matches card surfaces on the AMOLED shell */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-[#2c2c2e]", className)}
      style={style}
      aria-hidden
    />
  );
}

/** Watch-list row: still thumb + title pill + episode line + check circle */
export function ShowListRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-[#101011] p-2.5">
      <Skeleton className="h-[72px] w-[116px] flex-shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-2 py-0.5">
        <Skeleton className="h-6 w-28 rounded-full" />
        <Skeleton className="h-4 w-36" />
      </div>
      <Skeleton className="h-11 w-11 flex-shrink-0 rounded-full bg-[#3a3a3c]" />
    </div>
  );
}

/** 2:3 poster tile for grids */
export function PosterTileSkeleton({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn("w-full overflow-hidden rounded-md", className)}
      style={{ aspectRatio: "2 / 3" }}
    />
  );
}

/** 3-column poster grid */
export function PosterGridSkeleton({
  count = 6,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-3 gap-2", className)}>
      {Array.from({ length: count }, (_, i) => (
        <PosterTileSkeleton key={i} />
      ))}
    </div>
  );
}

/** WATCH LIST / UPCOMING tab bar */
export function TabsHeaderSkeleton() {
  return (
    <div className="relative flex">
      <div className="relative flex-1 pb-3 pt-2">
        <Skeleton className="mx-auto h-4 w-24" />
        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/40" />
      </div>
      <div className="flex-1 pb-3 pt-2">
        <Skeleton className="mx-auto h-4 w-20 opacity-50" />
      </div>
    </div>
  );
}

/** Section pill label */
export function SectionLabelSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("mb-3 mt-2 flex justify-center", className)}>
      <Skeleton className="h-7 w-28 rounded-full bg-[#3a3a3c]" />
    </div>
  );
}

/** Explore search input */
export function SearchBarSkeleton() {
  return <Skeleton className="mb-4 h-11 w-full rounded-xl bg-[#1c1c1e]" />;
}

/** Horizontal poster rail */
export function PosterRailSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="-mx-4 mb-6 flex gap-2 overflow-hidden px-4">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton
          key={i}
          className="h-[7.875rem] w-[5.25rem] flex-shrink-0 rounded-lg"
        />
      ))}
    </div>
  );
}

/** Show/movie detail backdrop + title block */
export function DetailHeroSkeleton() {
  return (
    <div className="relative h-detail-hero w-full overflow-hidden bg-[#1c1c1e]">
      <div className="absolute inset-0 animate-pulse bg-[#2c2c2e]" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/30" />
      <div className="absolute left-4 top-safe-float h-9 w-9 rounded-full bg-black/50" />
      <div className="absolute right-4 top-safe-float h-9 w-9 rounded-full bg-black/50" />
      <div className="absolute bottom-3 left-4 right-4 space-y-2">
        <Skeleton className="h-7 w-48 max-w-[75%] bg-white/15" />
        <Skeleton className="h-4 w-40 bg-white/10" />
      </div>
    </div>
  );
}

// ─── Full-page loading shells ───────────────────────────────────────────────

export function ShowsPageSkeleton() {
  return (
    <div
      className="min-h-dvh bg-black px-4 pb-nav-page"
      role="status"
      aria-label="Loading shows"
    >
      <StickyChrome contentClassName="pt-2">
        <TabsHeaderSkeleton />
      </StickyChrome>
      <section className="mb-6">
        <SectionLabelSkeleton />
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <ShowListRowSkeleton key={i} />
          ))}
        </div>
      </section>
      <section className="mb-6">
        <SectionLabelSkeleton className="mt-0" />
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <ShowListRowSkeleton key={i} />
          ))}
        </div>
      </section>
      <span className="sr-only">Loading shows…</span>
    </div>
  );
}

export function MoviesPageSkeleton() {
  return (
    <div
      className="min-h-dvh bg-black px-4 pb-nav-page"
      role="status"
      aria-label="Loading movies"
    >
      <StickyChrome contentClassName="pt-2">
        <TabsHeaderSkeleton />
      </StickyChrome>
      <section className="mb-6">
        <SectionLabelSkeleton />
        <PosterGridSkeleton count={6} />
      </section>
      <section className="mb-6">
        <SectionLabelSkeleton className="mt-0" />
        <PosterGridSkeleton count={3} />
      </section>
      <span className="sr-only">Loading movies…</span>
    </div>
  );
}

export function ExplorePageSkeleton() {
  return (
    <div
      className="min-h-dvh bg-black pb-nav-page"
      role="status"
      aria-label="Loading explore"
    >
      <StickyChrome contentClassName="px-4 pt-3 pb-1">
        <SearchBarSkeleton />
      </StickyChrome>
      <div className="px-4 pt-1">
        <div className="mb-5 flex gap-2 overflow-hidden pt-3">
          <Skeleton className="h-10 w-20 flex-shrink-0 rounded-full bg-white/15" />
          <Skeleton className="h-10 w-24 flex-shrink-0 rounded-full" />
        </div>
        <section className="mb-7">
          <Skeleton className="mb-2.5 h-3 w-24" />
          <Skeleton className="mb-3 h-8 w-48" />
          <PosterRailSkeleton count={5} />
        </section>
        <section className="mb-7">
          <Skeleton className="mb-2.5 h-3 w-24" />
          <Skeleton className="h-52 w-full rounded-2xl" />
        </section>
        <section className="mb-6">
          <div className="mb-3">
            <Skeleton className="h-7 w-28 rounded-full bg-[#3a3a3c]" />
          </div>
          <PosterRailSkeleton count={5} />
        </section>
        <section className="mb-6">
          <div className="mb-3">
            <Skeleton className="h-7 w-36 rounded-full bg-[#3a3a3c]" />
          </div>
          <PosterRailSkeleton count={6} />
        </section>
      </div>
      <span className="sr-only">Loading explore…</span>
    </div>
  );
}

export function ProfilePageSkeleton() {
  return (
    <div
      className="min-h-dvh bg-black pb-nav-page"
      role="status"
      aria-label="Loading profile"
    >
      <div className="relative mb-6">
        <div className="relative h-profile-hero w-full overflow-hidden bg-[#1c1c1e]">
          <div className="absolute inset-0 animate-pulse bg-[#2c2c2e]" />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-black/20" />
        </div>
        <div className="relative z-10 -mt-12 flex items-end gap-3 px-4">
          <Skeleton className="h-24 w-24 flex-shrink-0 rounded-full ring-4 ring-black overflow-hidden" />
          <div className="min-w-0 flex-1 space-y-2 pb-1">
            <Skeleton className="h-7 w-36" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      </div>

      <div className="px-4">
        <div className="mb-3">
          <Skeleton className="h-6 w-16" />
        </div>
        <div className="mb-8 rounded-2xl bg-card p-4">
          <div className="grid grid-cols-2 gap-x-3 gap-y-5">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </div>
        </div>

        <div className="mb-3">
          <Skeleton className="h-6 w-36" />
        </div>
        <PosterRailSkeleton count={4} />

        <div className="mb-3">
          <Skeleton className="h-6 w-28" />
        </div>
        <PosterRailSkeleton count={4} />
      </div>
      <span className="sr-only">Loading profile…</span>
    </div>
  );
}

export function ShowDetailSkeleton() {
  return (
    <div
      className="min-h-dvh bg-black pb-safe-page"
      role="status"
      aria-label="Loading show"
    >
      <DetailHeroSkeleton />

      <div className="px-4 pt-4">
        {/* About / Episodes tabs */}
        <div className="mb-4 flex gap-6 border-b border-white/10 pb-3">
          <Skeleton className="h-4 w-16 opacity-50" />
          <div className="relative">
            <Skeleton className="h-4 w-20" />
            <span className="absolute -bottom-3 left-0 right-0 h-0.5 bg-white/40" />
          </div>
        </div>

        {/* Next episode card */}
        <Skeleton className="mb-4 h-24 w-full rounded-xl" />

        {/* Season accordion rows */}
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      </div>
      <span className="sr-only">Loading show…</span>
    </div>
  );
}

export function MovieDetailSkeleton() {
  return (
    <div
      className="min-h-dvh bg-black pb-safe-page"
      role="status"
      aria-label="Loading movie"
    >
      <DetailHeroSkeleton />
      <div className="px-4 pt-4">
        <div className="mb-6 flex gap-2">
          <Skeleton className="h-12 flex-1 rounded-xl" />
          <Skeleton className="h-12 flex-1 rounded-xl" />
        </div>
        <div className="mb-6 space-y-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-5/6" />
        </div>
        <PosterRailSkeleton count={5} />
      </div>
      <span className="sr-only">Loading movie…</span>
    </div>
  );
}
