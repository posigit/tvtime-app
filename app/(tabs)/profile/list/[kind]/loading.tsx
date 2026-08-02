import { PosterGridSkeleton, Skeleton } from "@/components/skeletons";
import { StickyChrome } from "@/components/sticky-chrome";

export default function ProfileListLoading() {
  return (
    <div
      className="min-h-dvh bg-black pb-nav-page"
      role="status"
      aria-label="Loading list"
    >
      <StickyChrome contentClassName="px-4 pt-3 pb-2">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <Skeleton className="h-6 w-32" />
        </div>
      </StickyChrome>
      <div className="px-4 pt-4">
        <PosterGridSkeleton count={12} />
      </div>
      <span className="sr-only">Loading list…</span>
    </div>
  );
}
