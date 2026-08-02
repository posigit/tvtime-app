import { PosterGridSkeleton, Skeleton } from "@/components/skeletons";

export default function ProfileListLoading() {
  return (
    <div
      className="min-h-dvh bg-black px-4 pb-nav-page pt-safe"
      role="status"
      aria-label="Loading list"
    >
      <div className="mb-6 flex items-center gap-3 pt-4">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-6 w-32" />
      </div>
      <PosterGridSkeleton count={12} />
      <span className="sr-only">Loading list…</span>
    </div>
  );
}
