import { StickyChrome } from "@/components/sticky-chrome";
import { Skeleton } from "@/components/skeletons";

export default function TopTenLoading() {
  return (
    <div
      className="min-h-dvh bg-black pb-nav-page"
      role="status"
      aria-label="Loading Top 10"
    >
      <StickyChrome contentClassName="px-4 pt-2 pb-2">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-5 w-36" />
          </div>
        </div>
      </StickyChrome>
      <Skeleton className="h-[19.5rem] w-full rounded-none" />
      <div className="px-4 pt-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-white/[0.07] py-3"
          >
            <Skeleton className="h-10 w-10" />
            <Skeleton className="h-[5.35rem] w-[3.55rem] rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Loading Top 10…</span>
    </div>
  );
}
