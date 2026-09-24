import { Skeleton } from "@/components/skeletons";

export default function LoginLoading() {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6"
      role="status"
      aria-label="Loading sign in"
    >
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-12 w-full max-w-xs rounded-xl" />
      <span className="sr-only">Loading sign in…</span>
    </div>
  );
}
