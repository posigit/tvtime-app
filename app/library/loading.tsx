import { Skeleton } from "@/components/skeletons";

export default function LibraryLoading() {
  return (
    <div
      className="min-h-dvh bg-background px-4 pb-nav-page pt-6"
      role="status"
      aria-label="Loading library"
    >
      <Skeleton className="mb-4 h-8 w-44" />
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
      <span className="sr-only">Loading library…</span>
    </div>
  );
}
